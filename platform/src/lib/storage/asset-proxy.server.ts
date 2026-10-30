import { Effect } from "effect"

import { StorageUnavailable } from "./errors"

export const assetProxyResponse = Effect.fn("assetProxyResponse")(function* (location: string) {
  const signed = new URL(location)
  if (signed.protocol !== "https:") return yield* new StorageUnavailable()
  return new Response(null, {
    headers: {
      "X-Asset-Upstream": `${signed.hostname}:${signed.port || 443}`,
      "X-Asset-Host": signed.host,
      "X-Accel-Redirect": signed.pathname + signed.search,
    },
  })
})
