import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"

import { ImageSources } from "./image-source.server"
import { embeddedImage, IMAGE_MAX_BYTES, verifiedImage } from "./images"

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
      }),
  )
})
