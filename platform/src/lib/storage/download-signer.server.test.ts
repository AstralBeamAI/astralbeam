import { generateKeyPairSync, verify } from "node:crypto"
import { Effect, Layer } from "effect"
import { expect, test } from "vitest"

import { Config } from "@/lib/config/config"
import type { ConfigIssue, ConfigValues } from "@/lib/config/types"
import { ObjectStorage } from "./object-storage.server"
import { signDownload } from "./download-signer.server"

const signerKeys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const signerConfig = {
  download_signing_strategy: "cloudfront",
  cloudfront_download_origin: "https://files.example.com",
  cloudfront_key_pair_id: "KTESTPUBLICKEY",
  cloudfront_private_key: signerKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
} satisfies ConfigValues
const signerExpiry = Math.floor(Date.now() / 1000) + 60
const signerInput = {
  objectKey: "files/organization/object name+%2F?#.webp",
  expiresAt: new Date(signerExpiry * 1000 + 900),
}

function runSignerTest<A>(
  effect: Effect.Effect<A, unknown, Config | ObjectStorage>,
  values: ConfigValues,
  issues: ConfigIssue[] = [],
) {
  const config = Layer.succeed(Config, {
    snapshot: Effect.succeed({
      values: {
        s3_endpoint: "https://s3.us-west-2.amazonaws.com",
        s3_region: "us-west-2",
        s3_bucket: "private-test-files",
        s3_access_key_id: "fixture-key",
        s3_secret_access_key: "fixture-secret",
        ...values,
      },
      issues,
    }),
  } as unknown as Config["Service"])
  return Effect.runPromise(
    effect.pipe(Effect.provide(ObjectStorage.layerNoDeps.pipe(Layer.provideMerge(config)))),
  )
}

function expectNativeUrl(signed: string) {
  const url = new URL(signed)
  const signedAt = url.searchParams
    .get("X-Amz-Date")!
    .replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")
  expect(Date.parse(signedAt) / 1000 + Number(url.searchParams.get("X-Amz-Expires"))).toBe(
    signerExpiry,
  )
  expect(url.hostname).toBe("private-test-files.s3.us-west-2.amazonaws.com")
  expect(url.searchParams.get("response-cache-control")).toBe("private, no-store")
}

test("signs the exact CloudFront resource and preserves native S3", async () => {
  const [signed, native] = await runSignerTest(
    Effect.all([
      signDownload(signerInput),
      Effect.flatMap(ObjectStorage, (storage) =>
        storage.signedUrl({
          key: signerInput.objectKey,
          expiresAt: signerInput.expiresAt,
        }),
      ),
    ]),
    signerConfig,
  )
  const url = new URL(signed)
  const resource = "https://files.example.com/files/organization/object%20name%2B%252F%3F%23.webp"
  expect(url.origin + url.pathname).toBe(resource)
  expect(url.searchParams.get("Key-Pair-Id")).toBe("KTESTPUBLICKEY")
  expect(url.searchParams.get("Hash-Algorithm")).toBe("SHA256")
  expect(Number(url.searchParams.get("Expires"))).toBe(signerExpiry)
  const policy = JSON.stringify({
    Statement: [
      { Resource: resource, Condition: { DateLessThan: { "AWS:EpochTime": signerExpiry } } },
    ],
  })
  const encoded = url.searchParams.get("Signature")!
  const signature = Buffer.from(
    encoded.replaceAll("-", "+").replaceAll("_", "=").replaceAll("~", "/"),
    "base64",
  )
  expect(verify("SHA256", Buffer.from(policy), signerKeys.publicKey, signature)).toBe(true)
  expectNativeUrl(native)
})

test.each([{}, { ...signerConfig, download_signing_strategy: "s3" }])(
  "uses native S3 by default or explicit selection despite inactive CloudFront issues (%#)",
  async (values) => {
    const signed = await runSignerTest(signDownload(signerInput), values, [
      { key: "cloudfront_private_key", message: "Unreadable value" },
    ])
    expect(new URL(signed).pathname).toBe("/files/organization/object%20name%2B%252F%3F%23.webp")
    expectNativeUrl(signed)
  },
)

test.each([
  [{ download_signing_strategy: "cloudfront" }, []],
  [{ ...signerConfig, cloudfront_private_key: "invalid" }, []],
  [signerConfig, [{ key: "s3_endpoint", message: "Invalid endpoint" }]],
  [signerConfig, [{ key: "cloudfront_private_key", message: "Unreadable value" }]],
  [{ download_signing_strategy: "unknown" }, []],
] satisfies [ConfigValues, ConfigIssue[]][])(
  "fails closed on invalid selected settings (%#)",
  async (values, issues) => {
    const result = await runSignerTest(
      signDownload(signerInput).pipe(Effect.result),
      values,
      issues,
    )
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "StorageUnavailable" } })
  },
)
