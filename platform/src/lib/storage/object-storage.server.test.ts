import { createServer } from "node:http"
import { once } from "node:events"

import { Effect, Layer } from "effect"
import { expect, test } from "vitest"

import { Config } from "@/lib/config/config.server"
import { ObjectStorage } from "./object-storage.server"

test("rejects corrupt downloads and missing metadata, and cleans up after cancellation", async () => {
  const objects = new Map<string, Uint8Array>()
  let omitHeadSize = false
  let stall = false
  let notifyHead: () => void = () => undefined
  const headStarted = new Promise<void>((resolve) => {
    notifyHead = resolve
  })
  const server = createServer((request, response) => {
    const respond = async () => {
      const key = new URL(request.url!, "http://localhost").pathname
      if (request.method === "PUT") {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk as Uint8Array)
        objects.set(key, Buffer.concat(chunks))
        response.writeHead(200, { ETag: '"test"' }).end()
      } else if (request.method === "DELETE") {
        objects.delete(key)
        response.writeHead(204).end()
      } else {
        const bytes = objects.get(key)
        if (!bytes) {
          response.writeHead(404).end()
          return
        }
        if (request.method === "HEAD" && stall) {
          notifyHead()
          return
        }
        response.writeHead(
          200,
          request.method === "HEAD" && omitHeadSize ? {} : { "Content-Length": bytes.length },
        )
        response.end(request.method === "HEAD" ? undefined : new Uint8Array(bytes.length))
      }
    }
    void respond().catch(() => response.writeHead(500).end())
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No server address")
  const settings = {
    endpoint: `http://127.0.0.1:${address.port}`,
    region: "us-east-1",
    bucket: "test",
    accessKeyId: "test",
    secretAccessKey: "test",
    pathStyle: true,
  }
  const layer = ObjectStorage.layerNoDeps.pipe(
    Layer.provide(
      Layer.succeed(Config, {
        snapshot: Effect.succeed({
          issues: [],
          values: {
            s3_endpoint: settings.endpoint,
            s3_region: settings.region,
            s3_bucket: settings.bucket,
            s3_access_key_id: settings.accessKeyId,
            s3_secret_access_key: settings.secretAccessKey,
            s3_path_style: "true",
          },
        }),
      } as unknown as Config["Service"]),
    ),
  )
  try {
    const result = await Effect.runPromise(
      Effect.flatMap(ObjectStorage, (storage) => storage.testConnection(settings)).pipe(
        Effect.result,
        Effect.provide(layer),
      ),
    )
    expect(result._tag).toBe("Failure")
    expect(objects.size).toBe(0)
    omitHeadSize = true
    objects.set("/test/metadata", new Uint8Array([1]))
    const metadata = await Effect.runPromise(
      Effect.flatMap(ObjectStorage, (storage) => storage.head({ key: "metadata" })).pipe(
        Effect.result,
        Effect.provide(layer),
      ),
    )
    expect(metadata).toMatchObject({ _tag: "Failure", failure: { _tag: "StorageUnavailable" } })
    objects.delete("/test/metadata")
    omitHeadSize = false
    stall = true
    const controller = new AbortController()
    const interrupted = Effect.runPromiseExit(
      Effect.flatMap(ObjectStorage, (storage) => storage.testConnection(settings)).pipe(
        Effect.provide(layer),
      ),
      { signal: controller.signal },
    )
    await headStarted
    controller.abort()
    expect((await interrupted)._tag).toBe("Failure")
    expect(objects.size).toBe(0)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
