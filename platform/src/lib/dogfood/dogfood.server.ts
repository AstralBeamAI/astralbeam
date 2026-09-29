import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"

import { Database } from "@/db/database.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { Agents } from "@/lib/agents/agents.server"
import { Auth } from "@/lib/auth/auth.server"
import { Config } from "@/lib/config/config.server"
import type { DatabaseConfigState } from "@/lib/config/store.server"
import type { ConfigValues } from "@/lib/config/types"
import { ConfigurationBusy, OwnerOnboardingFailed } from "./errors.ts"
import {
  createDogfoodCredential,
  createDogfoodOwner,
  isDogfoodOwner,
  readDogfoodOrganization,
  readDogfoodOwner,
  replacePendingDogfoodOwner,
} from "./records.server.ts"
import {
  type DogfoodOnboarding,
  type OwnerOnboarding,
  type PendingOnboarding,
  PendingOwnerOnboardingJson,
} from "./schemas.ts"

const decodePendingOnboarding = Schema.decodeUnknownEffect(PendingOwnerOnboardingJson)
const DOGFOOD_KEYS = new Set([
  "dogfood_organization_id",
  "dogfood_api_key",
  "dogfood_pending_setup",
])

export class Dogfood extends Context.Service<
  Dogfood,
  {
    /** What `/configure` shows of owner onboarding, from current database values by UUID. */
    readonly onboarding: (values: ConfigValues) => Effect.Effect<DogfoodOnboarding>
    /** Creates or resumes the organization, owner, agent and credential, then mails a reset link.
     * Run it inside `withProvisioningLock` with the configuration changes preceding it. */
    readonly provision: (input: OwnerOnboarding) => Effect.Effect<void, OwnerOnboardingFailed>
    /**
     * Serializes configuration writes and provisioning across processes. The operation runs
     * outside the lock's transaction, so its recovery commits survive a failed email.
     */
    readonly withProvisioningLock: <A, E, R>(
      operation: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | ConfigurationBusy, R>
  }
>()("astralbeam/dogfood/Dogfood") {
  static readonly layerNoDeps = Layer.effect(
    Dogfood,
    Effect.gen(function* () {
      const db = yield* Database
      const config = yield* Config
      const auth = yield* Auth
      const agents = yield* Agents
      const provideDatabase = <A, E>(effect: Effect.Effect<A, E, Database | Config>) =>
        effect.pipe(
          Effect.provideService(Database, db),
          Effect.provideService(Config, config),
          mapDatabaseErrors(),
        )

      const savePendingOwner = (pending: PendingOnboarding) =>
        config
          .write([{ key: "dogfood_pending_setup", value: JSON.stringify(pending) }])
          .pipe(Effect.andThen(config.invalidate))

      const prepareOwnerOnboarding = Effect.fnUntraced(function* (
        input: OwnerOnboarding,
        state: DatabaseConfigState,
      ) {
        const stored = state.values.dogfood_pending_setup
        if (!stored) {
          if (yield* readDogfoodOwner(input.email)) {
            return yield* new OwnerOnboardingFailed({ reason: "ownerEmailInUse" })
          }
          if (yield* readDogfoodOrganization({ slug: input.organizationSlug })) {
            return yield* new OwnerOnboardingFailed({ reason: "slugInUse" })
          }
          const pending: PendingOnboarding = { ...input }
          yield* savePendingOwner(pending)
          return pending
        }
        const pending = yield* decodePendingOnboarding(stored).pipe(
          Effect.mapError(() => new OwnerOnboardingFailed({ reason: "pendingInvalid" })),
        )
        const customer = yield* readDogfoodOrganization({
          id: pending.organizationId,
          slug: pending.organizationSlug,
        })
        if (pending.organizationId && !customer) {
          return yield* new OwnerOnboardingFailed({ reason: "organizationUnavailable" })
        }
        if (!customer && (yield* readDogfoodOrganization({ slug: input.organizationSlug }))) {
          return yield* new OwnerOnboardingFailed({ reason: "slugInUse" })
        }
        const updated = {
          ...input,
          organizationId: customer?.id ?? pending.organizationId,
          organizationName: customer?.name ?? input.organizationName,
          organizationSlug: customer?.slug ?? input.organizationSlug,
        }
        if (pending.email === input.email) return { ...pending, ...updated }
        const replaced = yield* replacePendingDogfoodOwner(pending, updated)
        yield* config.invalidate
        return replaced
      })

      const onboarding = Effect.fn("Dogfood.onboarding")(function* (values: ConfigValues) {
        const pending = values.dogfood_pending_setup
          ? yield* decodePendingOnboarding(values.dogfood_pending_setup)
          : null
        const organizationId = values.dogfood_organization_id ?? pending?.organizationId
        const customer =
          organizationId || pending
            ? yield* readDogfoodOrganization({
                id: organizationId,
                slug: pending?.organizationSlug ?? "dogfood",
              }).pipe(provideDatabase)
            : null
        return {
          email: pending?.email ?? customer?.ownerEmail ?? "",
          organizationName: customer?.name ?? pending?.organizationName ?? "dogfood",
          organizationSlug: customer?.slug ?? pending?.organizationSlug ?? "dogfood",
          organizationCreated: Boolean(organizationId || customer),
          complete: Boolean(values.dogfood_organization_id),
        } satisfies DogfoodOnboarding
      }, Effect.orDie)

      const provision = Effect.fn("Dogfood.provision")(function* (input: OwnerOnboarding) {
        const state = yield* config.readStored
        if (state.values.dogfood_organization_id) return
        const current = yield* config.snapshot
        if (current.issues.some((issue) => !DOGFOOD_KEYS.has(issue.key))) {
          return yield* new OwnerOnboardingFailed({ reason: "configurationIncomplete" })
        }
        if (
          state.rows?.some((row) => DOGFOOD_KEYS.has(row.key) && row.storageStatus === "unreadable")
        ) {
          return yield* new OwnerOnboardingFailed({ reason: "undecryptable" })
        }
        let pending = yield* prepareOwnerOnboarding(
          { ...input, email: input.email.toLowerCase() },
          state,
        ).pipe(provideDatabase)
        const owner =
          (yield* readDogfoodOwner(pending.email).pipe(provideDatabase)) ??
          (yield* createDogfoodOwner(pending.email).pipe(provideDatabase))
        let customer: { id: string; name: string } | null = yield* readDogfoodOrganization({
          id: pending.organizationId,
          slug: pending.organizationSlug,
        }).pipe(provideDatabase)
        if (
          customer &&
          !(yield* isDogfoodOwner({ organizationId: customer.id, userId: owner.id }).pipe(
            provideDatabase,
          ))
        ) {
          return yield* new OwnerOnboardingFailed({ reason: "organizationNotOwned" })
        }
        if (!customer && pending.organizationId) {
          return yield* new OwnerOnboardingFailed({ reason: "organizationUnavailable" })
        }
        customer ??= yield* auth
          .api((api) =>
            api.createOrganization({
              body: {
                name: pending.organizationName,
                slug: pending.organizationSlug,
                userId: owner.id,
              },
            }),
          )
          .pipe(
            Effect.mapError(() => new OwnerOnboardingFailed({ reason: "organizationNotCreated" })),
          )
        const organizationId = customer.id
        yield* savePendingOwner({ ...pending, organizationId })
        yield* agents.provisionDefault({ organizationId, organizationName: customer.name })
        if (!pending.apiKey) {
          pending = yield* createDogfoodCredential({ ...pending, organizationId }).pipe(
            provideDatabase,
          )
          yield* config.invalidate
        }
        const appBaseUrl = yield* config.get("app_base_url")
        yield* auth
          .requestPasswordReset({
            email: pending.email,
            redirectTo: new URL("/auth/reset-password", appBaseUrl).href,
          })
          .pipe(Effect.mapError(() => new OwnerOnboardingFailed({ reason: "emailNotSent" })))
        yield* config.write([
          { key: "dogfood_organization_id", value: organizationId },
          { key: "dogfood_api_key", value: pending.apiKey! },
          { key: "dogfood_pending_setup", value: null },
        ])
        yield* config.invalidate
      })

      const withProvisioningLock = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          const context = yield* Effect.context<R>()
          return yield* db.transaction((transaction) =>
            Effect.gen(function* () {
              const [lock] = yield* transaction
                .execute<{ acquired: boolean }>(
                  sql`select pg_try_advisory_xact_lock(734028190) as acquired`,
                  "objects",
                )
                .pipe(Effect.orDie)
              if (!lock?.acquired) return yield* new ConfigurationBusy()
              // Keep recovery commits outside the lock's ambient transaction, even when email
              // fails. https://effect.website/docs/requirements-management/services/
              return yield* Effect.setContext(operation, context)
            }),
          )
        }).pipe(mapDatabaseErrors())

      return Dogfood.of({ onboarding, provision, withProvisioningLock })
    }),
  )

  static readonly layer = Dogfood.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(Agents.layer, Auth.layer, Config.layer, Database.layer)),
  )
}
