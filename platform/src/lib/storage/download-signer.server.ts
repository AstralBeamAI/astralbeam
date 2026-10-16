import { getSignedUrl } from "@aws-sdk/cloudfront-signer"
import { Effect } from "effect"

import { Config } from "@/lib/config/config"
import { StorageUnavailable } from "./errors"
import { ObjectStorage } from "./object-storage.server"

export const signDownload = Effect.fn("signDownload")(function* ({
  objectKey,
  expiresAt,
}: {
  objectKey: string
  expiresAt: Date
}) {
  const { values, issues } = yield* (yield* Config).snapshot
  if (
    issues.some((issue) => issue.key.startsWith("s3_") || issue.key === "download_signing_strategy")
  )
    return yield* new StorageUnavailable()
  switch (values.download_signing_strategy ?? "s3") {
    case "s3":
      return yield* (yield* ObjectStorage).signedUrl({ key: objectKey, expiresAt })
    case "cloudfront": {
      const origin = values.cloudfront_download_origin
      const keyPairId = values.cloudfront_key_pair_id
      const privateKey = values.cloudfront_private_key
      if (
        !origin ||
        !keyPairId ||
        !privateKey ||
        issues.some((issue) => issue.key.startsWith("cloudfront_"))
      )
        return yield* new StorageUnavailable()
      return yield* Effect.try({
        try: () =>
          getSignedUrl({
            url: `${origin}/${objectKey.split("/").map(encodeURIComponent).join("/")}`,
            keyPairId,
            privateKey,
            algorithm: "SHA256",
            dateLessThan: Math.floor(expiresAt.getTime() / 1000) * 1000,
          }),
        catch: () => new StorageUnavailable(),
      })
    }
    default:
      return yield* new StorageUnavailable()
  }
})
