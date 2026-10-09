import { calcPrice, REMOTE_DATA_JSON_URL, type Provider } from "@pydantic/genai-prices"
import { DateTime, Effect, Schema } from "effect"

import { Config } from "@/lib/config/config.server"
import { ModelPriceCatalogProvidersSchema } from "../model-providers/pricing-catalog-schemas.ts"

const modelPriceCatalogRefresh = Effect.gen(function* () {
  const body = yield* Effect.tryPromise(async (signal) => {
    const response = await fetch(REMOTE_DATA_JSON_URL, { signal, redirect: "error" })
    if (!response.ok) throw new Error("Pricing catalog download failed")
    let bytes = 0
    const body = response.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, stream) {
          bytes += chunk.byteLength
          if (bytes > 16 * 1024 * 1024) throw new Error("Pricing catalog is too large")
          stream.enqueue(chunk)
        },
      }),
    )
    return new Response(body).text()
  }).pipe(Effect.timeout("30 seconds"))
  const providers = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(ModelPriceCatalogProvidersSchema),
  )(body)
  for (const providerType of ["openai", "anthropic", "openrouter"]) {
    const provider = providers.find((item) => item.id === providerType)
    if (!provider || provider.models.length === 0)
      return yield* Effect.fail(new Error("Pricing catalog is missing a supported provider"))
    for (const model of provider.models) {
      yield* Effect.try(() => calcPrice({}, model.id, { provider: provider as Provider }))
    }
  }
  const digest = yield* Effect.tryPromise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  )
  const revision = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  const config = yield* Config
  yield* config.writeModelPriceCatalog({
    revision,
    fetchedAt: DateTime.formatIso(yield* DateTime.now),
    providers,
  })
})

export default modelPriceCatalogRefresh
