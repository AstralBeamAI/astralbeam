import { generateKeyPairSync, verify } from "node:crypto"
import { Effect, Layer } from "effect"
import { expect, test } from "vitest"

import { Database, type EffectDatabase } from "@/db/database"
import { Config } from "@/lib/config/config"
import type { ConfigIssue, ConfigValues } from "@/lib/config/types"
import { fileDownloadUrl, fileResponse } from "./file-response.server"
import { ObjectStorage } from "./object-storage.server"

const fileDownloadSigningKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
const fileDownloadCloudFront = {
  cloudfront_download_origin: "https://files.example.com",
  cloudfront_key_pair_id: "KTESTPUBLICKEY",
  cloudfront_private_key: fileDownloadSigningKey.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
} satisfies ConfigValues
const fileDownloadIdentity = { organizationId: "organization", fileId: "file" }
const fileDownloadObjectKey = "files/organization/object name+%2F?#.webp"

function fileDownloadTestLayer(
  values: ConfigValues = {},
  issues: ConfigIssue[] = [],
  stored = true,
) {
  const config = Layer.succeed(Config, {
    snapshot: Effect.succeed({
      values: {
        s3_endpoint: "https://s3.us-west-2.amazonaws.com",
        s3_region: "us-west-2",
        s3_bucket: "private-test-files",
        s3_access_key_id: "fixture-access-key",
        s3_secret_access_key: "fixture-secret-key",
        s3_path_style: "false",
        ...values,
      },
      issues,
    }),
  } as unknown as Config["Service"])
  return Layer.merge(
    Layer.succeed(Database, {
      select: () => ({
        from: () => ({
          where: () => Effect.succeed(stored ? [{ key: fileDownloadObjectKey }] : []),
        }),
      }),
    } as unknown as EffectDatabase),
    ObjectStorage.layerNoDeps.pipe(Layer.provideMerge(config)),
  )
}

test("signs only the requested CloudFront object for one minute and retains native S3 signing", async () => {
  const before = Math.floor(Date.now() / 1000)
  const { download, native } = await Effect.runPromise(
    Effect.gen(function* () {
      return {
        download: yield* fileDownloadUrl(fileDownloadIdentity),
        native: yield* (yield* ObjectStorage).signedUrl({ key: fileDownloadObjectKey }),
      }
    }).pipe(Effect.provide(fileDownloadTestLayer(fileDownloadCloudFront))),
  )
  const url = new URL(download)
  const resource = "https://files.example.com/files/organization/object%20name%2B%252F%3F%23.webp"
  expect(url.origin + url.pathname).toBe(resource)
  expect(url.searchParams.get("Key-Pair-Id")).toBe("KTESTPUBLICKEY")
  expect(url.searchParams.get("Hash-Algorithm")).toBe("SHA256")
  const expires = Number(url.searchParams.get("Expires"))
  expect(expires).toBeGreaterThanOrEqual(before + 60)
  expect(expires).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60)
  const policy = JSON.stringify({
    Statement: [{ Resource: resource, Condition: { DateLessThan: { "AWS:EpochTime": expires } } }],
  })
  const signature = Buffer.from(
    url.searchParams
      .get("Signature")!
      .replaceAll("-", "+")
      .replaceAll("_", "=")
      .replaceAll("~", "/"),
    "base64",
  )
  expect(verify("SHA256", Buffer.from(policy), fileDownloadSigningKey.publicKey, signature)).toBe(
    true,
  )
  expect(
    verify(
      "SHA256",
      Buffer.from(policy.replace("object", "another")),
      fileDownloadSigningKey.publicKey,
      signature,
    ),
  ).toBe(false)
  const nativeUrl = new URL(native)
  expect(nativeUrl.hostname).toBe("private-test-files.s3.us-west-2.amazonaws.com")
  expect(nativeUrl.searchParams.get("X-Amz-Expires")).toBe("60")
  expect(nativeUrl.searchParams.get("response-cache-control")).toBe("private, no-store")
})

test("uses native S3 downloads when CloudFront is absent", async () => {
  const response = await Effect.runPromise(
    fileResponse(fileDownloadUrl(fileDownloadIdentity)).pipe(
      Effect.provide(fileDownloadTestLayer()),
    ),
  )
  expect(response.status).toBe(302)
  expect(response.headers.get("cache-control")).toBe("private, no-store")
  const url = new URL(response.headers.get("location")!)
  expect(url.hostname).toBe("private-test-files.s3.us-west-2.amazonaws.com")
  expect(url.searchParams.get("X-Amz-Expires")).toBe("60")
  expect(url.searchParams.get("response-cache-control")).toBe("private, no-store")
})

test("fails closed for broken CloudFront configuration or a changed S3 destination", async () => {
  for (const [values, issues] of [
    [{ cloudfront_download_origin: "https://files.example.com" }, []],
    [{ ...fileDownloadCloudFront, cloudfront_private_key: "secret-invalid-private-key" }, []],
    [fileDownloadCloudFront, [{ key: "s3_endpoint", message: "Destination changed" }]],
    [{}, [{ key: "cloudfront_private_key", message: "Unreadable stored value" }]],
  ] satisfies [ConfigValues, ConfigIssue[]][]) {
    const response = await Effect.runPromise(
      fileResponse(fileDownloadUrl(fileDownloadIdentity)).pipe(
        Effect.provide(fileDownloadTestLayer(values, issues)),
      ),
    )
    expect(response.status).toBe(503)
    expect(response.headers.get("location")).toBeNull()
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.text()).toBe("")
  }
})

test("does not issue a download URL for an unavailable file", async () => {
  const response = await Effect.runPromise(
    fileResponse(fileDownloadUrl(fileDownloadIdentity)).pipe(
      Effect.provide(fileDownloadTestLayer(fileDownloadCloudFront, [], false)),
    ),
  )
  expect(response.status).toBe(404)
  expect(response.headers.get("location")).toBeNull()
})
