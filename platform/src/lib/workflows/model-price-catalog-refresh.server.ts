import { calcPrice, REMOTE_DATA_JSON_URL, type Provider } from "@pydantic/genai-prices"
import { Effect, Schedule, Schema } from "effect"
import { Activity, Workflow } from "effect/workflow"

import { ModelPriceCatalogProvidersSchema } from "../model-providers/pricing-catalog-schemas.ts"
import { writeModelPriceCatalog } from "../model-providers/pricing-catalog.server.ts"

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
  yield* writeModelPriceCatalog({
    providers,
  })
})

export const modelPriceCatalogInitialization = Workflow.make("ModelPriceCatalogInitialization/v2", {
  payload: {},
  idempotencyKey: () => "initial",
})

export const modelPriceCatalogInitializationLayer = modelPriceCatalogInitialization.toLayer(() =>
  Activity.make({
    name: "RefreshCatalog",
    execute: modelPriceCatalogRefresh.pipe(
      Effect.catchDefect(() => Effect.fail(new Error("Initial pricing catalog refresh failed"))),
      Effect.tapError(() => Effect.logWarning("Initial pricing catalog refresh failed. Retrying")),
      Effect.retry(Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")])),
      Effect.orDie,
    ),
  }),
)

export default modelPriceCatalogRefresh
