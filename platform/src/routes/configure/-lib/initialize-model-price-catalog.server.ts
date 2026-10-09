import { Effect } from "effect"

import { provideClusterWorkflowEngine } from "@/lib/cluster/runtime.server"
import { Config } from "@/lib/config/config.server"
import { modelPriceCatalogInitialization } from "@/lib/workflows/model-price-catalog-refresh.server"

export const initializeModelPriceCatalog = Effect.gen(function* () {
  const config = yield* Config
  if (
    (yield* config.setupState).setupComplete &&
    !(yield* config.readModelPriceCatalog)?.fetchedAt
  ) {
    yield* modelPriceCatalogInitialization
      .execute({}, { discard: true })
      .pipe(provideClusterWorkflowEngine)
  }
}).pipe(
  Effect.catchCause(() =>
    Effect.logWarning("Initial pricing catalog submission failed. Daily refresh remains scheduled"),
  ),
)
