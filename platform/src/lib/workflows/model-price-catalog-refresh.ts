import { calcPrice, REMOTE_DATA_JSON_URL, type Provider } from "@pydantic/genai-prices"
import { Effect, Predicate, Schedule, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Activity, Workflow } from "effect/workflow"

import { ModelPriceCatalogProvidersSchema } from "../model-providers/pricing-catalog-schemas.ts"
import {
  modelPriceCatalogProviderIds,
  writeModelPriceCatalog,
} from "../model-providers/pricing-catalog.server.ts"

const modelPriceCatalogRefresh = Effect.gen(function* () {
  const body = yield* Effect.gen(function* () {
    const client = HttpClient.filterStatusOk(HttpClient.withScope(yield* HttpClient.HttpClient))
    const response = yield* client.get(REMOTE_DATA_JSON_URL)
    return yield* response.stream.pipe(
      Stream.limitBytes(16 * 1024 * 1024, () =>
        Stream.fail(new Error("Pricing catalog is too large")),
      ),
      Stream.mkUint8Array,
      Effect.map((bytes) => new TextDecoder().decode(bytes)),
    )
  }).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
    Effect.scoped,
    Effect.timeout("30 seconds"),
  )
  const providers = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(ModelPriceCatalogProvidersSchema),
  )(body)
  for (const id of Object.values(modelPriceCatalogProviderIds)) {
    const provider = providers.find((item) => item.id === id)
    if (!provider || provider.models.length === 0)
      return yield* Effect.fail(new Error("Pricing catalog is missing a supported provider"))
    for (const model of provider.models) {
      yield* Effect.try(() => calcPrice({}, model.id, { provider: provider as Provider }))
    }
  }
  yield* writeModelPriceCatalog({ providers }).pipe(
    // Config.write exposes database failures as defects. Only those failures are retryable here.
    Effect.catchDefect((error) =>
      Predicate.isTagged(error, "SqlError") || Predicate.isTagged(error, "EffectDrizzleQueryError")
        ? Effect.fail(error)
        : Effect.die(error),
    ),
  )
})

export const modelPriceCatalogInitialization = Workflow.make("ModelPriceCatalogInitialization/v2", {
  payload: {},
  idempotencyKey: () => "initial",
})

export const modelPriceCatalogInitializationLayer = modelPriceCatalogInitialization.toLayer(() =>
  Activity.make({
    name: "RefreshCatalog",
    execute: modelPriceCatalogRefresh.pipe(
      Effect.tapError(() => Effect.logWarning("Initial pricing catalog refresh failed. Retrying")),
      Effect.retry(Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")])),
      Effect.orDie,
    ),
  }),
)

export default modelPriceCatalogRefresh
