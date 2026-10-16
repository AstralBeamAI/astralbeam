import { generateKeyPairSync, verify } from "node:crypto"
import { Effect, Layer } from "effect"
import { expect, test } from "vitest"

import { Database, type EffectDatabase } from "@/db/database"
import { Config } from "@/lib/config/config"
import type { ConfigIssue, ConfigValues } from "@/lib/config/types"
import { fileDownloadUrl, fileResponse } from "./file-response.server"
import { ObjectStorage } from "./object-storage.server"
import { signDownload } from "./download-signer.server"

const fileDownloadSigningKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
const fileDownloadCloudFront = {
  download_signing_strategy: "cloudfront",
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

test.each(["https://files.example.com", "https://d111111abcdef8.cloudfront.net"])(
  "signs only the requested CloudFront object at %s and retains native S3 signing",
  async (origin) => {
    const before = Math.floor(Date.now() / 1000)
    const { download, native } = await Effect.runPromise(
      Effect.gen(function* () {
        return {
          download: yield* fileDownloadUrl(fileDownloadIdentity),
          native: yield* (yield* ObjectStorage).signedUrl({
            key: fileDownloadObjectKey,
            expiresAt: new Date((before + 60) * 1000),
          }),
        }
      }).pipe(
        Effect.provide(
          fileDownloadTestLayer({ ...fileDownloadCloudFront, cloudfront_download_origin: origin }),
        ),
      ),
    )
    const url = new URL(download)
    const resource = `${origin}/files/organization/object%20name%2B%252F%3F%23.webp`
    expect(url.origin + url.pathname).toBe(resource)
    expect(url.searchParams.get("Key-Pair-Id")).toBe("KTESTPUBLICKEY")
    expect(url.searchParams.get("Hash-Algorithm")).toBe("SHA256")
    const expires = Number(url.searchParams.get("Expires"))
    expect(expires).toBeGreaterThanOrEqual(before + 60)
    expect(expires).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60)
    const policy = JSON.stringify({
      Statement: [
        { Resource: resource, Condition: { DateLessThan: { "AWS:EpochTime": expires } } },
      ],
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
    expect(Number(nativeUrl.searchParams.get("X-Amz-Expires"))).toBeGreaterThanOrEqual(59)
    expect(nativeUrl.searchParams.get("response-cache-control")).toBe("private, no-store")
  },
)

test.each([
  [{}, []],
  [{ ...fileDownloadCloudFront, download_signing_strategy: "s3" }, []],
  [
    { cloudfront_download_origin: "https://files.example.com" },
    [{ key: "cloudfront_private_key", message: "Unreadable stored value" }],
  ],
] satisfies [ConfigValues, ConfigIssue[]][])(
  "uses native S3 downloads by default and when selected with retained CloudFront settings (%#)",
  async (values, issues) => {
    const response = await Effect.runPromise(
      fileResponse(fileDownloadUrl(fileDownloadIdentity)).pipe(
        Effect.provide(fileDownloadTestLayer(values, issues)),
      ),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const url = new URL(response.headers.get("location")!)
    expect(url.hostname).toBe("private-test-files.s3.us-west-2.amazonaws.com")
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBeGreaterThanOrEqual(59)
    expect(url.searchParams.get("response-cache-control")).toBe("private, no-store")
  },
)

test("fails closed for broken CloudFront configuration or a changed S3 destination", async () => {
  for (const [values, issues] of [
    [{ download_signing_strategy: "cloudfront" }, []],
    [{ ...fileDownloadCloudFront, cloudfront_private_key: "secret-invalid-private-key" }, []],
    [fileDownloadCloudFront, [{ key: "s3_endpoint", message: "Destination changed" }]],
    [
      fileDownloadCloudFront,
      [{ key: "cloudfront_private_key", message: "Unreadable stored value" }],
    ],
    [{ download_signing_strategy: "unknown" }, []],
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

test.each(["s3", "cloudfront"])(
  "honors the requested absolute expiry with %s signing",
  async (strategy) => {
    const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 37_900)
    const signed = await Effect.runPromise(
      signDownload({ objectKey: fileDownloadObjectKey, expiresAt }).pipe(
        Effect.provide(
          fileDownloadTestLayer({ ...fileDownloadCloudFront, download_signing_strategy: strategy }),
        ),
      ),
    )
    const url = new URL(signed)
    let expiry = Number(url.searchParams.get("Expires"))
    if (strategy === "s3") {
      const signedAt = url.searchParams
        .get("X-Amz-Date")!
        .replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")
      expiry = Date.parse(signedAt) / 1000 + Number(url.searchParams.get("X-Amz-Expires"))
    }
    expect(expiry).toBe(Math.floor(expiresAt.getTime() / 1000))
  },
)

test("does not issue a download URL for an unavailable file", async () => {
  const response = await Effect.runPromise(
    fileResponse(fileDownloadUrl(fileDownloadIdentity)).pipe(
      Effect.provide(fileDownloadTestLayer(fileDownloadCloudFront, [], false)),
    ),
  )
  expect(response.status).toBe(404)
  expect(response.headers.get("location")).toBeNull()
})
