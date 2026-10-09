import { verifiedImage } from "./image-validation.server"
import { lookup } from "node:dns/promises"
import { request as httpsRequest } from "node:https"
import { BlockList } from "node:net"
import { Context, Effect, Layer } from "effect"

import { isPrivateModelEndpointAddress } from "@/lib/model-providers/endpoints.server"
import { ImageImportUnavailable, ImageSourceMissing, InvalidImage } from "./errors"
import { IMAGE_MAX_BYTES } from "./images"

// Refuse special-purpose and address-translation destinations in external image imports.
// https://www.iana.org/assignments/iana-ipv6-special-registry
const unavailableImageAddresses = new BlockList()
for (const address of ["192.0.2.0", "198.51.100.0", "203.0.113.0", "192.88.99.0"])
  unavailableImageAddresses.addSubnet(address, 24, "ipv4")
for (const [address, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fec0::", 10],
] as const)
  unavailableImageAddresses.addSubnet(address, prefix, "ipv6")

function unsafeImageAddress(address: string, family: number): boolean {
  return (
    isPrivateModelEndpointAddress(address) ||
    unavailableImageAddresses.check(address, family === 6 ? "ipv6" : "ipv4")
  )
}

async function downloadPublicImage(source: string, signal: AbortSignal): Promise<Uint8Array> {
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
      addresses.some(({ address, family }) => unsafeImageAddress(address, family))
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
        throw new ImageSourceMissing({ status })
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
      error instanceof InvalidImage ||
      error instanceof ImageSourceMissing ||
      error instanceof ImageImportUnavailable
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
      InvalidImage | ImageSourceMissing | ImageImportUnavailable
    >
  }
>()("astralbeam/storage/ImageSources") {
  static readonly layer = Layer.succeed(ImageSources, { fetch: fetchExternalImage })
}
