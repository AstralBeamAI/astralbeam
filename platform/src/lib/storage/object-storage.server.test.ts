import { createServer } from "node:http"
import { once } from "node:events"

import { DeleteObjectCommand, ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3"
import { Effect, Layer, Logger, ManagedRuntime } from "effect"
import { expect, test, vi, type MockInstance } from "vitest"

import { Config } from "@/lib/config/config.server"
import { ObjectStorage } from "./object-storage.server"

test("purges only exact-key versions and markers, retries truncated pages and limits fallback", async () => {
  const layer = ObjectStorage.layerNoDeps.pipe(
    Layer.provide(
      Layer.succeed(Config, {
        snapshot: Effect.succeed({
          issues: [],
          values: {
            s3_endpoint: "http://127.0.0.1:9000",
            s3_region: "us-east-1",
            s3_bucket: "test",
            s3_access_key_id: "fixture-key",
            s3_secret_access_key: "fixture-secret",
            s3_path_style: "true",
          },
        }),
      } as unknown as Config["Service"]),
    ),
  )
  const runtime = ManagedRuntime.make(layer)
  const requests = vi.spyOn(S3Client.prototype, "send") as unknown as MockInstance<
    (command: ListObjectVersionsCommand | DeleteObjectCommand) => Promise<unknown>
  >
  const remove = Effect.flatMap(ObjectStorage, (storage) =>
    storage.remove({ key: "files/avatar" }),
  ).pipe(Effect.result)
  try {
    requests
      .mockResolvedValueOnce({
        Versions: [
          { Key: "files/avatar", VersionId: "old" },
          { Key: "files/avatar", VersionId: "null" },
          { Key: "files/avatar-other", VersionId: "sibling" },
        ],
        DeleteMarkers: [{ Key: "files/avatar", VersionId: "marker" }],
        IsTruncated: true,
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    expect(await runtime.runPromise(remove)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "StorageUnavailable" },
    })
    expect(requests.mock.calls[0]![0]).toBeInstanceOf(ListObjectVersionsCommand)
    expect(requests.mock.calls[0]![0].input).toEqual({
      Bucket: "test",
      Prefix: "files/avatar",
      MaxKeys: 1000,
    })
    expect(requests.mock.calls.slice(1).map(([command]) => command.input)).toEqual(
      ["old", "null", "marker"].map((VersionId) => ({
        Bucket: "test",
        Key: "files/avatar",
        VersionId,
      })),
    )
    requests.mockReset().mockResolvedValueOnce({ Versions: [], DeleteMarkers: [] })
    expect((await runtime.runPromise(remove))._tag).toBe("Success")
    expect(requests).toHaveBeenCalledTimes(1)
    requests
      .mockReset()
      .mockRejectedValueOnce(
        Object.assign(new Error("private provider details"), { name: "NotImplemented" }),
      )
      .mockResolvedValueOnce(undefined)
    expect((await runtime.runPromise(remove))._tag).toBe("Success")
    expect(requests).toHaveBeenCalledTimes(2)
    expect(requests.mock.calls[1]![0]).toBeInstanceOf(DeleteObjectCommand)
    expect(requests.mock.calls[1]![0].input).toEqual({
      Bucket: "test",
      Key: "files/avatar",
      VersionId: undefined,
    })
    requests
      .mockReset()
      .mockRejectedValueOnce(
        Object.assign(new Error("private provider details"), { name: "AccessDenied" }),
      )
    expect((await runtime.runPromise(remove))._tag).toBe("Failure")
    expect(requests).toHaveBeenCalledTimes(1)
    requests.mockReset().mockResolvedValueOnce({ Versions: [{ Key: "files/avatar" }] })
    expect((await runtime.runPromise(remove))._tag).toBe("Failure")
    expect(requests).toHaveBeenCalledTimes(1)
  } finally {
    requests.mockRestore()
    await runtime.dispose()
  }
})

test("rejects corrupt downloads and missing metadata, and cleans up after cancellation", async () => {
  const objects = new Map<string, Uint8Array>()
  const versions = new Set<string>()
  let finishOversized: () => void = () => undefined
  const oversizedClosed = new Promise<void>((resolve) => {
    finishOversized = resolve
  })
  const metadataCredentials: string[] = []
  let omitHeadSize = false
  let corruptDownloads = true
  let denyMissing = false
  let denyVersions = false
  let stall = false
  let notifyHead: () => void = () => undefined
  const headStarted = new Promise<void>((resolve) => {
    notifyHead = resolve
  })
  const server = createServer((request, response) => {
    const respond = async () => {
      const url = new URL(request.url!, "http://localhost")
      const key = url.pathname
      if (url.searchParams.has("versions")) {
        if (denyVersions) {
          response.writeHead(403, { "Content-Type": "application/xml" })
          response.end("<Error><Code>AccessDenied</Code></Error>")
          return
        }
        response.writeHead(200, { "Content-Type": "application/xml" })
        response.end(
          `<ListVersionsResult><IsTruncated>false</IsTruncated>${[...versions]
            .filter((storedKey) =>
              storedKey.slice("/test/".length).startsWith(url.searchParams.get("prefix")!),
            )
            .map(
              (storedKey) =>
                `<Version><Key>${storedKey.slice("/test/".length)}</Key><VersionId>fixture-version</VersionId></Version>`,
            )
            .join("")}</ListVersionsResult>`,
        )
        return
      }
      if (key === "/test/oversized") {
        response.on("close", finishOversized)
        response.writeHead(200, { "Content-Length": 1024 * 1024 })
        response.write(new Uint8Array([1]))
        return
      }
      if (key === "/test/metadata") {
        metadataCredentials.push(request.headers.authorization ?? "")
      }
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
        versions.add(key)
        response.writeHead(200, { ETag: '"test"', "x-amz-version-id": "fixture-version" }).end()
      } else if (request.method === "DELETE") {
        objects.delete(key)
        if (url.searchParams.get("versionId") === "fixture-version") versions.delete(key)
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
        snapshot: Effect.sync(() => ({
          issues: [],
          values: {
            s3_endpoint: settings.endpoint,
            s3_region: settings.region,
            s3_bucket: settings.bucket,
            s3_access_key_id: settings.accessKeyId,
            s3_secret_access_key: settings.secretAccessKey,
            s3_path_style: "true",
          },
        })),
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
    expect(versions.size).toBe(0)
    omitHeadSize = true
    objects.set("/test/metadata", new Uint8Array([1]))
    const runtime = ManagedRuntime.make(layer)
    const requests = vi.spyOn(S3Client.prototype, "send")
    try {
      const inspect = Effect.flatMap(ObjectStorage, (storage) =>
        storage.head({ key: "metadata" }),
      ).pipe(Effect.result)
      const metadata = await runtime.runPromise(inspect)
      expect(metadata).toMatchObject({ _tag: "Failure", failure: { _tag: "StorageUnavailable" } })
      await runtime.runPromise(inspect)
      expect(requests.mock.contexts[1]).toBe(requests.mock.contexts[0])
      settings.accessKeyId = "rotated-fixture-key"
      await runtime.runPromise(inspect)
      expect(requests.mock.contexts[2]).not.toBe(requests.mock.contexts[0])
      expect(metadataCredentials[2]).toContain("Credential=rotated-fixture-key/")
      const oversized = await runtime.runPromise(
        Effect.flatMap(ObjectStorage, (storage) =>
          storage.get({ key: "oversized", maxBytes: 1 }),
        ).pipe(Effect.result),
      )
      expect(oversized._tag).toBe("Failure")
      await oversizedClosed
    } finally {
      await runtime.dispose()
      requests.mockRestore()
    }
    objects.delete("/test/metadata")
    omitHeadSize = false
    corruptDownloads = false
    denyVersions = true
    expect(
      await Effect.runPromise(
        Effect.flatMap(ObjectStorage, (storage) => storage.testConnection(settings)).pipe(
          Effect.result,
          Effect.provide(layer),
        ),
      ),
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "StorageUnavailable" } })
    expect(versions.size).toBe(0)
    denyVersions = false
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
      expect(versions.size).toBe(0)
    }
    const logs: string[] = []
    const denied = await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* ObjectStorage
        yield* storage.head({ key: "missing" }).pipe(Effect.result)
        return yield* storage.get({ key: "denied", maxBytes: 1024 })
      }).pipe(
        Effect.result,
        Effect.provide(layer),
        Effect.provide(Logger.layer([Logger.map(Logger.formatJson, (entry) => logs.push(entry))])),
      ),
    )
    expect(denied).toMatchObject({ _tag: "Failure", failure: { _tag: "StorageUnavailable" } })
    expect(logs).toHaveLength(1)
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
    expect(versions.size).toBe(0)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
