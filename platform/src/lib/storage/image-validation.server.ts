import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import {
  ConfigurationFiles,
  initializeImageMagick,
  MagickImageCollection,
  MagickReadSettings,
} from "@imagemagick/magick-wasm"
import { Effect } from "effect"

import { InvalidImage } from "./errors"
import { IMAGE_MAX_BYTES } from "./images"

// Only raster decoders may read untrusted input. Disable disk-backed pixel caches.
// https://imagemagick.org/security-policy/
const profileImageConfiguration = ConfigurationFiles.default
profileImageConfiguration.policy.data = profileImageConfiguration.policy.data.replace(
  "</policymap>",
  `
  <policy domain="coder" rights="none" pattern="*" />
  <policy domain="coder" rights="read" pattern="{PNG,JPEG,GIF,WEBP}" />
  <policy domain="resource" name="memory" value="256MiB" />
  <policy domain="resource" name="map" value="0" />
  <policy domain="resource" name="disk" value="0" />
</policymap>`,
)
// Compiled npm assets live in Deno's virtual filesystem rather than local node_modules.
// https://docs.deno.com/runtime/reference/cli/compile/#including-data-files
const { Deno: profileImageDeno } = globalThis as unknown as {
  Deno: { build: { standalone: boolean } }
}
const profileImageWasmPath = profileImageDeno.build.standalone
  ? new URL(import.meta.resolve("@imagemagick/magick-wasm/magick.wasm"))
  : createRequire(import.meta.url).resolve("@imagemagick/magick-wasm/magick.wasm")
const profileImageDecoder = initializeImageMagick(
  readFileSync(profileImageWasmPath),
  profileImageConfiguration,
)

export const verifiedImage = Effect.fn("verifiedImage")((bytes: Uint8Array) =>
  Effect.tryPromise({
    try: async (signal) => {
      if (!bytes.byteLength || bytes.byteLength > IMAGE_MAX_BYTES) throw new InvalidImage()
      await profileImageDecoder
      signal.throwIfAborted()
      const frames = MagickImageCollection.create()
      try {
        // Inspect at most two frames, rejecting animation without decoding every frame.
        frames.ping(bytes, new MagickReadSettings({ frameCount: 2 }))
        if (frames.length !== 1) throw new InvalidImage()
        const image = frames[0]!
        let warned = false
        image.onWarning = () => {
          warned = true
        }

        if (image.width * image.height > 16_777_216) throw new InvalidImage()
        image.read(bytes, new MagickReadSettings({ frameCount: 1 }))
        if (warned || !["PNG", "JPEG", "GIF", "WEBP"].includes(image.format))
          throw new InvalidImage()
        return { bytes, contentType: `image/${image.format.toLowerCase()}` }
      } finally {
        frames.dispose()
      }
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
