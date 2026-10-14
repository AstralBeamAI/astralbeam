import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { Database, type EffectDatabase } from "@/db/database"
import { formatUsageLimitId } from "./schemas.ts"
import { UsageLimits } from "./usage-limits.server.ts"

const FOREIGN_USAGE_LIMIT_ID = formatUsageLimitId({
  organizationId: "01990a5d-ac96-774b-b942-6b13c85384cc",
  id: "01990a5d-ac96-774b-b942-6b13c85384ca",
})

describe("UsageLimits", () => {
  it.effect("refuses another organization's limit ID before any query", () =>
    Effect.gen(function* () {
      const usageLimits = yield* UsageLimits
      const input = {
        organizationId: "01990a5d-ac96-774b-b942-6b13c85384cb",
        usageLimitId: FOREIGN_USAGE_LIMIT_ID,
      }
      assert.strictEqual((yield* Effect.flip(usageLimits.get(input)))._tag, "UsageLimitNotFound")
      const versioned = { ...input, lockVersion: 0 }
      const removal = yield* Effect.flip(usageLimits.remove(versioned))
      assert.strictEqual(removal._tag, "UsageLimitChanged")
    }).pipe(
      // Any query throws, so a passing test proves the refusal happened before the database was reached.
      Effect.provide(
        UsageLimits.layerNoDeps.pipe(Layer.provide(Layer.succeed(Database, {} as EffectDatabase))),
      ),
    ),
  )
})
