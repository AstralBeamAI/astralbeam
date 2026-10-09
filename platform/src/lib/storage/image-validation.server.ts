import { Effect } from "effect"
import { createImageLibrary } from "purejsimage/browser"
import { gifCodec } from "purejsimage/codecs/gif"
import { jpegCodec } from "purejsimage/codecs/jpeg"
import { pngCodec } from "purejsimage/codecs/png"
import { webpCodec } from "purejsimage/codecs/webp"

import { InvalidImage } from "./errors"
import { IMAGE_MAX_BYTES } from "./images"

const profileImageDecoder = createImageLibrary([pngCodec, jpegCodec, gifCodec, webpCodec])

export const verifiedImage = Effect.fn("verifiedImage")((bytes: Uint8Array) =>
  Effect.tryPromise({
    try: async (signal) => {
      const image = await profileImageDecoder.open(bytes, {
        signal,
        frame: 0,
        limits: {
          maxInputBytes: IMAGE_MAX_BYTES,
          maxPixels: 16_777_216,
          maxDecodedBytes: 64 * 1024 * 1024,
        },
      })
      const metadata = await image.metadata({ signal })
      // Pixel decoding rejects corrupt data that valid headers alone cannot detect.
      // https://purejsimage.com/api/#image
      await image.png().toBuffer({ signal })
      return { bytes, contentType: metadata.mimeType }
    },
    catch: () => new InvalidImage(),
  }),
)

export const embeddedImage = Effect.fn("embeddedImage")((source: string) =>
  Effect.try({
    try: () => {
      const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source)
      if (!match || match[1]!.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4) throw new InvalidImage()
      return Uint8Array.from(atob(match[1]!), (char) => char.charCodeAt(0))
    },
    catch: () => new InvalidImage(),
  }).pipe(Effect.flatMap(verifiedImage)),
)
