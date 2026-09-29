import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

import { Database } from "@/db/database.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { apiKey } from "@/db/schema/organizations.server"
import { Config } from "@/lib/config/config.server"
import { ApiKeyNotFound, DogfoodApiKeyInUse, LastApiKey } from "./errors.ts"
import { ORGANIZATION_API_KEY_CONFIG_ID, parseApiKeyCredential } from "./schemas.ts"

export class ApiKeys extends Context.Service<
  ApiKeys,
  {
    /**
     * The key dashboard directories sign with: for now the first enabled, unexpired one, without
     * a stored setting. `digest` is Better Auth's stored verifier and never leaves the server.
     */
    readonly defaultKey: (
      organizationId: string,
    ) => Effect.Effect<{ readonly id: string; readonly digest: string } | null>
    readonly hasAny: (organizationId: string) => Effect.Effect<boolean>
    /** Refuses the embedded assistant's key and the last one, under row locks that serialize
     * concurrent deletions. The caller must already be authorized to delete it. */
    readonly remove: (input: {
      readonly organizationId: string
      readonly keyId: string
    }) => Effect.Effect<void, ApiKeyNotFound | DogfoodApiKeyInUse | LastApiKey>
  }
>()("astralbeam/api-keys/ApiKeys") {
  static readonly layerNoDeps = Layer.effect(
    ApiKeys,
    Effect.gen(function* () {
      const db = yield* Database
      const config = yield* Config

      const defaultKey = Effect.fn("ApiKeys.defaultKey")(function* (organizationId: string) {
        const [key] = yield* db
          .select({ id: apiKey.id, digest: apiKey.key })
          .from(apiKey)
          .where(
            and(
              eq(apiKey.organizationId, organizationId),
              eq(apiKey.configId, ORGANIZATION_API_KEY_CONFIG_ID),
              eq(apiKey.enabled, true),
              or(isNull(apiKey.expiresAt), gt(apiKey.expiresAt, sql`now()`)),
            ),
          )
          .orderBy(asc(apiKey.createdAt), asc(apiKey.id))
          .limit(1)
        return key ?? null
      }, Effect.orDie)

      const hasAny = Effect.fn("ApiKeys.hasAny")(function* (organizationId: string) {
        const rows = yield* db
          .select({ id: apiKey.id })
          .from(apiKey)
          .where(eq(apiKey.organizationId, organizationId))
          .limit(1)
        return rows.length > 0
      }, Effect.orDie)

      const remove = Effect.fn("ApiKeys.remove")(function* (input: {
        organizationId: string
        keyId: string
      }) {
        const dogfoodCredential = parseApiKeyCredential(yield* config.get("dogfood_api_key"))
        if (dogfoodCredential?.id === input.keyId) return yield* new DogfoodApiKeyInUse()
        yield* db.transaction((transaction) =>
          Effect.gen(function* () {
            const keys = yield* transaction
              .select({ id: apiKey.id })
              .from(apiKey)
              .where(eq(apiKey.organizationId, input.organizationId))
              .for("update")
            if (!keys.some((key) => key.id === input.keyId)) return yield* new ApiKeyNotFound()
            if (keys.length === 1) return yield* new LastApiKey()
            yield* transaction
              .delete(apiKey)
              .where(
                and(eq(apiKey.organizationId, input.organizationId), eq(apiKey.id, input.keyId)),
              )
          }),
        )
      }, mapDatabaseErrors())

      return ApiKeys.of({ defaultKey, hasAny, remove })
    }),
  )

  static readonly layer = ApiKeys.layerNoDeps.pipe(
    Layer.provide(Layer.merge(Database.layer, Config.layer)),
  )
}
