import { assert, describe, it } from "@effect/vitest"
import { artifactContentDisposition, detectSandboxArtifactMimeType } from "./artifacts"

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
