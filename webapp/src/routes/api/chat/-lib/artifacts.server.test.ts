import { describe, expect, it } from "vitest"

import {
  artifactDispositionFilename,
  detectSandboxArtifactMimeType,
  isInlineArtifactMimeType,
  mintSandboxArtifactTicket,
  type SandboxArtifactTicket,
  verifySandboxArtifactTicket,
} from "./artifacts.server"

const ticket: SandboxArtifactTicket = {
  organizationId: "0192aaaa-aaaa-7aaa-aaaa-aaaaaaaaaaaa",
  tenantUserId: "tenant-user-1",
  sandboxProviderId: "0192bbbb-bbbb-7bbb-bbbb-bbbbbbbbbbbb",
  providerSandboxId: "sbx_12345",
  path: "/workspace/report.png",
  mimeType: "image/png",
  size: 1024,
}

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

  it("rejects garbage", async () => {
    await expect(verifySandboxArtifactTicket("not-a-ticket")).resolves.toBeUndefined()
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

describe("artifactDispositionFilename", () => {
  it("keeps the basename and strips header-breaking characters", () => {
    expect(artifactDispositionFilename("/workspace/out/report v2.pdf")).toBe("report v2.pdf")
    expect(artifactDispositionFilename('/workspace/a"b\r\n.txt')).toBe("a_b__.txt")
    expect(artifactDispositionFilename("/workspace/")).toBe("artifact")
  })
})
