import { createServer } from "node:http"
import { once } from "node:events"

import { Effect, Layer, Logger } from "effect"
import { expect, test } from "vitest"

import { Config } from "@/lib/config/config.server"
import { ObjectStorage } from "./object-storage.server"

test("rejects corrupt downloads and missing metadata, and cleans up after cancellation", async () => {
  const objects = new Map<string, Uint8Array>()
  let omitHeadSize = false
  let corruptDownloads = true
  let denyMissing = false
  let stall = false
  let notifyHead: () => void = () => undefined
  const headStarted = new Promise<void>((resolve) => {
    notifyHead = resolve
  })
  const server = createServer((request, response) => {
    const respond = async () => {
      const key = new URL(request.url!, "http://localhost").pathname
      if (key === "/test/denied") {
        response.writeHead(403, {
          "Content-Type": "application/xml",
          "x-amz-request-id": "fixture-request",
        })
        response.end(
          "<Error><Code>AccessDenied</Code><Message>private-failure-details</Message></Error>",
        )
        return
      }
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
          response.writeHead(denyMissing ? 403 : 404).end()
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
        response.end(
          request.method === "HEAD"
            ? undefined
            : corruptDownloads
              ? new Uint8Array(bytes.length)
              : bytes,
        )
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
    accessKeyId: "fixture-access-key",
    secretAccessKey: "fixture-secret-key",
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
    corruptDownloads = false
    for (const denied of [true, false]) {
      denyMissing = denied
      const checked = await Effect.runPromise(
        Effect.flatMap(ObjectStorage, (storage) => storage.testConnection(settings)).pipe(
          Effect.result,
          Effect.provide(layer),
        ),
      )
      expect(checked._tag).toBe(denied ? "Failure" : "Success")
      expect(objects.size).toBe(0)
    }
    const logs: string[] = []
    const denied = await Effect.runPromise(
      Effect.flatMap(ObjectStorage, (storage) =>
        storage.get({ key: "denied", maxBytes: 1024 }),
      ).pipe(
        Effect.result,
        Effect.provide(layer),
        Effect.provide(Logger.layer([Logger.map(Logger.formatJson, (entry) => logs.push(entry))])),
      ),
    )
    expect(denied).toMatchObject({ _tag: "Failure", failure: { _tag: "StorageUnavailable" } })
    expect(JSON.parse(logs[0]!)).toMatchObject({
      annotations: { errorType: "AccessDenied", httpStatusCode: 403, requestId: "fixture-request" },
    })
    for (const privateValue of [
      "private-failure-details",
      settings.endpoint,
      settings.accessKeyId,
      settings.secretAccessKey,
    ])
      expect(logs.join("")).not.toContain(privateValue)
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
