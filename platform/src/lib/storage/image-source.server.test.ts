import { verifiedImage, embeddedImage } from "./image-validation.server"
import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"
import sharp from "sharp"

import { ImageSources } from "./image-source.server"
import { IMAGE_MAX_BYTES } from "./images"

describe("image import boundaries", () => {
  it.effect.each([
    "http://example.com/photo.png",
    "https://user:password@example.com/photo.png",
    "https://example.com:9443/photo.png",
    "https://localhost/photo.png",
    "https://127.0.0.1/photo.png",
    "https://169.254.169.254/photo.png",
    "https://192.0.2.1/photo.png",
    "https://[::1]/photo.png",
    "https://[::ffff:127.0.0.1]/photo.png",
    "https://[64:ff9b::7f00:1]/photo.png",
    "https://[2001:db8::1]/photo.png",
    "https://[fc00::1]/photo.png",
  ])("refuses %s before an HTTPS request", (source) =>
    Effect.gen(function* () {
      const result = yield* Effect.flatMap(ImageSources, (images) => images.fetch({ source })).pipe(
        Effect.result,
        Effect.provide(ImageSources.layer),
      )
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") expect(result.failure._tag).toBe("InvalidImage")
    }),
  )
  it.effect(
    "refuses malformed embedded images, executable image formats and oversized content",
    () =>
      Effect.gen(function* () {
        for (const source of [
          "data:image/png;base64,not-base64",
          "data:image/png;base64,aGVsbG8=",
          "data:image/svg+xml;base64,PHN2Zy8+",
        ]) {
          expect((yield* embeddedImage(source).pipe(Effect.result))._tag).toBe("Failure")
        }
        expect(
          (yield* verifiedImage(new Uint8Array(IMAGE_MAX_BYTES + 1)).pipe(Effect.result))._tag,
        ).toBe("Failure")
        expect(
          (yield* verifiedImage(
            Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
          ).pipe(Effect.result))._tag,
        ).toBe("Failure")
      }),
  )
  it("refuses small compressed images whose decoded pixels exceed the limit", async () => {
    const bytes = await sharp({
      create: { width: 4097, height: 4097, channels: 3, background: "white" },
    })
      .png()
      .toBuffer()
    expect(bytes.byteLength).toBeLessThan(IMAGE_MAX_BYTES)
    expect((await Effect.runPromise(verifiedImage(bytes).pipe(Effect.result)))._tag).toBe("Failure")
  })
})

const validImageSamples = {
  png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP438AAAAQBAYCQNzXrAAAAAElFTkSuQmCC",
  jpeg: "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL4AeKr/2Q==",
  gif: "R0lGODlhAQABAIAAAExpcf+AACH5BAUAAAAALAAAAAABAAEAAAICTAEAOw==",
  webp: "UklGRjwAAABXRUJQVlA4IDAAAAAQAgCdASoBAAEAAUAmJaACdLoB+AH4AAPIAP7qKv/98CWlQN/yBf/bQzqhL/fMAAA=",
} as const

it.each(Object.entries(validImageSamples))(
  "decodes %s pixels and rejects a broken image body with matching magic bytes",
  async (format, sample) => {
    const bytes = Uint8Array.from(Buffer.from(sample, "base64"))
    const verified = await Effect.runPromise(verifiedImage(bytes))
    expect(verified).toEqual({ bytes, contentType: `image/${format}` })
    if (format === "gif") {
      const animated = Buffer.concat([bytes.subarray(0, -1), bytes.subarray(19)])
      expect((await Effect.runPromise(verifiedImage(animated).pipe(Effect.result)))._tag).toBe(
        "Failure",
      )
    }
    const corrupt = Uint8Array.from(
      Buffer.concat([bytes.subarray(0, 12), Buffer.alloc(33), bytes.subarray(-8)]),
    )
    if (format === "webp") new DataView(corrupt.buffer).setUint32(4, corrupt.length - 8, true)
    expect((await Effect.runPromise(verifiedImage(corrupt).pipe(Effect.flip)))._tag).toBe(
      "InvalidImage",
    )
  },
)
