import { assert, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer } from "effect"

import { Database, type EffectDatabase } from "@/db/database"
import { Agents } from "@/lib/agents/agents.server"
import { Auth } from "@/lib/auth/auth.server"
import { Config } from "@/lib/config/config"
import { Dogfood } from "./dogfood.server.ts"

it.effect("finishes an in-flight lock probe before committing successful work", () =>
  Effect.gen(function* () {
    const probing = yield* Deferred.make<void>()
    const finishProbe = yield* Deferred.make<void>()
    let queries = 0
    let committed = false
    const probe = Deferred.succeed(probing, undefined).pipe(
      Effect.andThen(Deferred.await(finishProbe)),
    )
    const database = {
      transaction: <A, E, R>(
        execute: (transaction: { execute: () => Effect.Effect<unknown> }) => Effect.Effect<A, E, R>,
      ) =>
        execute({
          execute: () => (++queries === 1 ? Effect.succeed([{ acquired: true }]) : probe),
        }).pipe(Effect.tap(() => Effect.sync(() => (committed = true)))),
    } as unknown as EffectDatabase
    const dogfood = yield* Dogfood.pipe(
      Effect.provide(
        Dogfood.layerNoDeps.pipe(
          Layer.provide([
            Layer.succeed(Database, database),
            Layer.mock(Agents, {}),
            Layer.mock(Auth, {}),
            Layer.mock(Config, {}),
          ]),
        ),
      ),
    )
    const work = yield* Effect.forkChild(
      dogfood.withProvisioningLock(Deferred.await(probing).pipe(Effect.as("done"))),
    )
    yield* Deferred.await(probing)
    yield* Effect.yieldNow
    assert.isFalse(committed)
    yield* Deferred.succeed(finishProbe, undefined)
    assert.strictEqual(yield* Fiber.join(work), "done")
    assert.isTrue(committed)
  }),
)
