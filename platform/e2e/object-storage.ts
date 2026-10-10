import { once } from "node:events"
import { createServer, type Server } from "node:http"

export async function startBrowserStorageFixture(state: {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>
  corrupt: boolean
  inspect?: () => Promise<void>
}) {
  const server = createServer((request, response) => {
    const respond = async () => {
      if (state.inspect) await state.inspect()
      const url = new URL(request.url!, "http://localhost")
      const key = url.pathname
      if (!key.startsWith("/storage/v1/s3/")) {
        response.writeHead(404).end()
        return
      }
      if (request.method === "PUT") {
        const chunks: Uint8Array[] = []
        for await (const chunk of request) chunks.push(chunk as Uint8Array)
        state.objects.set(key, {
          bytes: Buffer.concat(chunks),
          contentType: String(request.headers["content-type"] ?? "application/octet-stream"),
        })
        response.writeHead(200, { ETag: '"fixture"' }).end()
      } else if (request.method === "DELETE") {
        state.objects.delete(key)
        response.writeHead(204).end()
      } else {
        const object = state.objects.get(key)
        if (!object) {
          response.writeHead(404).end()
          return
        }
        response.writeHead(200, {
          "Content-Length": object.bytes.length,
          "Content-Type": object.contentType,
        })
        response.end(
          request.method === "HEAD"
            ? undefined
            : state.corrupt
              ? new Uint8Array(object.bytes.length)
              : object.bytes,
        )
      }
    }
    void respond().catch(() => response.writeHead(500).end())
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No storage fixture address")
  return { server, endpoint: `http://127.0.0.1:${address.port}/storage/v1/s3` }
}

export function stopBrowserStorageFixture(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
