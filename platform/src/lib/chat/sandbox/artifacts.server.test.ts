import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { beforeAll, vi } from "vitest"

import {
  artifactContentDisposition,
  deriveArtifactTicketKey,
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
  // The ticket key derives from the deployment encryption root, so the tests get one.
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "artifact-ticket-test-key-32-characters!!")
})

function verifiedTicket(token: string) {
  return Effect.gen(function* () {
    const key = yield* deriveArtifactTicketKey
    return yield* Effect.option(verifySandboxArtifactTicket(key, token))
  })
}

describe("sandbox artifact tickets", () => {
  it.effect("round-trips a minted ticket", () =>
    Effect.gen(function* () {
      const token = yield* mintSandboxArtifactTicket(yield* deriveArtifactTicketKey, ticket)
      assert.deepStrictEqual(yield* verifiedTicket(token), Option.some(ticket))
    }),
  )

  it.effect("rejects a tampered ticket", () =>
    Effect.gen(function* () {
      const token = yield* mintSandboxArtifactTicket(yield* deriveArtifactTicketKey, ticket)
      const [header = "", payload = "", signature = ""] = token.split(".")
      const forged = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))) as Record<
        string,
        unknown
      >
      forged["path"] = "/workspace/../etc/passwd"
      const forgedPayload = btoa(JSON.stringify(forged))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "")
      const verified = yield* verifiedTicket(`${header}.${forgedPayload}.${signature}`)
      assert.strictEqual(verified._tag, "None")
    }),
  )

  it.effect("rejects garbage and tickets missing required identity or content claims", () =>
    Effect.gen(function* () {
      const key = yield* deriveArtifactTicketKey
      assert.strictEqual((yield* verifiedTicket("not-a-ticket"))._tag, "None")
      const { sha256: _sha256, ...withoutDigest } = ticket
      const digestless = yield* mintSandboxArtifactTicket(
        key,
        withoutDigest as SandboxArtifactTicket,
      )
      assert.strictEqual((yield* verifiedTicket(digestless))._tag, "None")
      const { tenantId: _tenantId, ...withoutTenant } = ticket
      const tenantless = yield* mintSandboxArtifactTicket(
        key,
        withoutTenant as SandboxArtifactTicket,
      )
      assert.strictEqual((yield* verifiedTicket(tenantless))._tag, "None")
    }),
  )
})

describe("detectSandboxArtifactMimeType", () => {
  it("sniffs raster images and PDFs from magic bytes", () => {
    const sniff = (bytes: number[]) => detectSandboxArtifactMimeType(new Uint8Array(bytes))
    assert.strictEqual(sniff([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "image/png")
    assert.strictEqual(sniff([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")
    assert.strictEqual(sniff([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf")
  })

  it("treats valid UTF-8 as plain text, so SVG can never be served as an image", () => {
    const svg = new TextEncoder().encode('<svg onload="alert(1)"></svg>')
    assert.strictEqual(detectSandboxArtifactMimeType(svg), "text/plain")
    assert.isFalse(isInlineArtifactMimeType("text/plain"))
  })

  it("treats NUL-bearing and invalid UTF-8 content as an opaque download", () => {
    const sniff = (bytes: number[]) => detectSandboxArtifactMimeType(new Uint8Array(bytes))
    assert.strictEqual(sniff([0x00, 0x01, 0x02]), "application/octet-stream")
    assert.strictEqual(sniff([0xc3, 0x28]), "application/octet-stream")
  })
})

describe("artifactContentDisposition", () => {
  it("keeps header values ByteString-safe for non-ASCII names", () => {
    const value = artifactContentDisposition("inline", "/workspace/😀 chart.png")
    assert.strictEqual(
      value,
      `inline; filename="__ chart.png"; filename*=UTF-8''%F0%9F%98%80%20chart.png`,
    )
    // The proof that matters: the Headers constructor accepts it.
    assert.doesNotThrow(() => new Headers({ "content-disposition": value }))
  })

  it("strips header-breaking characters and never emits an empty filename", () => {
    assert.include(
      artifactContentDisposition("attachment", '/workspace/a"b\r\n.txt'),
      'filename="a_b__.txt"',
    )
    assert.include(artifactContentDisposition("attachment", "/workspace/"), 'filename="artifact"')
  })
})
