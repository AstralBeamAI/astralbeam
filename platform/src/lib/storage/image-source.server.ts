import sharp from "sharp"
import { lookup } from "node:dns/promises"
import { request as httpsRequest } from "node:https"
import { Context, Effect, Layer } from "effect"

import { isPrivateModelEndpointAddress } from "@/lib/model-providers/endpoints.server"
import { ImageImportUnavailable, InvalidImage } from "./errors"
import { IMAGE_MAX_BYTES } from "./image-limits"

async function downloadPublicImage(source: string, signal: AbortSignal): Promise<Uint8Array> {
  if (!URL.canParse(source)) throw new InvalidImage()
  let url = new URL(source)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "")
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443") ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost")
    )
      throw new InvalidImage()
    const addresses = await lookup(hostname, { all: true })
    if (
      !addresses.length ||
      addresses.some(({ address }) => isPrivateModelEndpointAddress(address))
    )
      throw new InvalidImage()
    signal.throwIfAborted()
    // The connection uses the validated DNS answers, while TLS still authenticates the original host.
    // https://nodejs.org/api/http.html#httprequesturl-options-callback
    const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          signal,
          headers: { accept: "image/png, image/jpeg, image/gif, image/webp" },
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, addresses)
            else callback(null, addresses[0]!.address, addresses[0]!.family)
          },
        },
        resolve,
      )
      request.once("error", reject)
      request.end()
    })
    try {
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        url = new URL(response.headers.location, url)
        continue
      }
      if (status >= 400 && status < 500 && ![408, 425, 429].includes(status))
        throw new InvalidImage()
      if (status !== 200) throw new ImageImportUnavailable()
      const declaredSize = Number(response.headers["content-length"])
      if (declaredSize > IMAGE_MAX_BYTES) throw new InvalidImage()
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of response) {
        const bytes = chunk as Uint8Array
        size += bytes.length
        if (size > IMAGE_MAX_BYTES) throw new InvalidImage()
        chunks.push(bytes)
      }
      return Buffer.concat(chunks)
    } finally {
      response.destroy()
    }
  }
  throw new InvalidImage()
}

const fetchExternalImage = Effect.fn("ImageSources.fetch")(({ source }: { source: string }) =>
  Effect.tryPromise({
    try: (signal) => downloadPublicImage(source, signal),
    catch: (error) =>
      error instanceof InvalidImage || error instanceof ImageImportUnavailable
        ? error
        : new ImageImportUnavailable(),
  }).pipe(
    Effect.timeout("20 seconds"),
    Effect.catchTag("TimeoutError", () => Effect.fail(new ImageImportUnavailable())),
    Effect.flatMap(verifiedImage),
  ),
)

export class ImageSources extends Context.Service<
  ImageSources,
  {
    readonly fetch: (options: {
      source: string
    }) => Effect.Effect<
      { bytes: Uint8Array; contentType: string },
      InvalidImage | ImageImportUnavailable
    >
  }
>()("astralbeam/storage/ImageSources") {
  static readonly layer = Layer.succeed(ImageSources, { fetch: fetchExternalImage })
}

// Only allow raster input from memory. https://sharp.pixelplumbing.com/api-utility/#unblock
sharp.block({ operation: ["VipsForeignLoad"] })
sharp.unblock({
  operation: [
    "VipsForeignLoadJpegBuffer",
    "VipsForeignLoadPngBuffer",
    "VipsForeignLoadNsgifBuffer",
    "VipsForeignLoadWebpBuffer",
  ],
})

export const verifiedImage = Effect.fn("verifiedImage")((bytes: Uint8Array) =>
  Effect.tryPromise({
    try: async (signal) => {
      if (!bytes.byteLength || bytes.byteLength > IMAGE_MAX_BYTES) throw new InvalidImage()
      signal.throwIfAborted()
      const image = sharp(bytes, { failOn: "warning", limitInputPixels: 16_777_216 })
      const metadata = await image.metadata()
      if ((metadata.pages ?? 1) !== 1 || !["png", "jpeg", "gif", "webp"].includes(metadata.format))
        throw new InvalidImage()
      // Metadata alone does not validate the pixel data. Decode without storing the result.
      await image.raw().toBuffer()
      signal.throwIfAborted()
      return { bytes, contentType: `image/${metadata.format}` }
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
