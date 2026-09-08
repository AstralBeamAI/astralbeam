import { beforeAll, describe, expect, it, vi } from "vitest"

import {
  artifactContentDigest,
  artifactContentDisposition,
  detectSandboxArtifactMimeType,
  isInlineArtifactMimeType,
  mintSandboxArtifactTicket,
  type SandboxArtifactTicket,
  verifySandboxArtifactTicket,
} from "./artifacts.server"

const ticket: SandboxArtifactTicket = {
  organizationId: "0192aaaa-aaaa-7aaa-aaaa-aaaaaaaaaaaa",
  tenantId: "tenant-1",
  tenantUserId: "tenant-user-1",
  sandboxProviderId: "0192bbbb-bbbb-7bbb-bbbb-bbbbbbbbbbbb",
  providerSandboxId: "sbx_12345",
  path: "/workspace/report.png",
  mimeType: "image/png",
  size: 1024,
  sha256: "0000000000000000000000000000000000000000000",
}

beforeAll(() => {
  // The ticket key derives from the deployment encryption root; give the tests one.
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "artifact-ticket-test-key-32-characters!!")
})

describe("sandbox artifact tickets", () => {
  it("round-trips a minted ticket", async () => {
    const token = await mintSandboxArtifactTicket(ticket)
    await expect(verifySandboxArtifactTicket(token)).resolves.toEqual(ticket)
  })

  it("rejects a tampered ticket", async () => {
    const token = await mintSandboxArtifactTicket(ticket)
    const [header = "", payload = "", signature = ""] = token.split(".")
    const forged = JSON.parse(
      atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
    ) as Record<string, unknown>
    forged["path"] = "/workspace/../etc/passwd"
    const forgedPayload = btoa(JSON.stringify(forged)).replaceAll("+", "-").replaceAll("/", "_")
      .replace(/=+$/, "")
    await expect(verifySandboxArtifactTicket(`${header}.${forgedPayload}.${signature}`))
      .resolves.toBeUndefined()
  })

  it("rejects garbage and tickets missing required identity or content claims", async () => {
    await expect(verifySandboxArtifactTicket("not-a-ticket")).resolves.toBeUndefined()
    const { sha256: _sha256, ...withoutDigest } = ticket
    const token = await mintSandboxArtifactTicket(withoutDigest as SandboxArtifactTicket)
    await expect(verifySandboxArtifactTicket(token)).resolves.toBeUndefined()
    const { tenantId: _tenantId, ...withoutTenant } = ticket
    const tenantless = await mintSandboxArtifactTicket(withoutTenant as SandboxArtifactTicket)
    await expect(verifySandboxArtifactTicket(tenantless)).resolves.toBeUndefined()
  })
})

describe("artifactContentDigest", () => {
  it("binds to exact bytes", async () => {
    const published = await artifactContentDigest(new Uint8Array([1, 2, 3]))
    const replaced = await artifactContentDigest(new Uint8Array([1, 2, 4]))
    expect(published).not.toBe(replaced)
    await expect(artifactContentDigest(new Uint8Array([1, 2, 3]))).resolves.toBe(published)
  })
})

describe("detectSandboxArtifactMimeType", () => {
  it("sniffs raster images and PDFs from magic bytes", () => {
    expect(detectSandboxArtifactMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])))
      .toBe("image/png")
    expect(detectSandboxArtifactMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])))
      .toBe("image/jpeg")
    expect(detectSandboxArtifactMimeType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])))
      .toBe("application/pdf")
  })

  it("treats valid UTF-8 as plain text, so SVG can never be served as an image", () => {
    const svg = new TextEncoder().encode('<svg onload="alert(1)"></svg>')
    expect(detectSandboxArtifactMimeType(svg)).toBe("text/plain")
    expect(isInlineArtifactMimeType("text/plain")).toBe(false)
  })

  it("treats NUL-bearing and invalid UTF-8 content as an opaque download", () => {
    expect(detectSandboxArtifactMimeType(new Uint8Array([0x00, 0x01, 0x02])))
      .toBe("application/octet-stream")
    expect(detectSandboxArtifactMimeType(new Uint8Array([0xc3, 0x28])))
      .toBe("application/octet-stream")
  })
})

describe("artifactContentDisposition", () => {
  it("keeps ASCII names in both parameters", () => {
    expect(artifactContentDisposition("attachment", "/workspace/out/report v2.pdf"))
      .toBe(`attachment; filename="report v2.pdf"; filename*=UTF-8''report%20v2.pdf`)
  })

  it("keeps header values ByteString-safe for non-ASCII names", () => {
    const value = artifactContentDisposition("inline", "/workspace/😀 chart.png")
    expect(value).toBe(`inline; filename="__ chart.png"; filename*=UTF-8''%F0%9F%98%80%20chart.png`)
    // The proof that matters: the Headers constructor accepts it.
    expect(() => new Headers({ "content-disposition": value })).not.toThrow()
  })

  it("strips header-breaking characters and never emits an empty filename", () => {
    expect(artifactContentDisposition("attachment", '/workspace/a"b\r\n.txt'))
      .toContain('filename="a_b__.txt"')
    expect(artifactContentDisposition("attachment", "/workspace/"))
      .toContain('filename="artifact"')
  })
})
