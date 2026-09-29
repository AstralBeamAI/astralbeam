import { and, asc, eq, ne, sql } from "drizzle-orm"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import { Context, Effect, Equal, Layer, Option, Result, Schema } from "effect"

import { Database } from "@/db/database.server"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"
import { decryptDatabaseValue } from "@/db/lib/encryption.server"
import {
  deleteWithOptimisticLock,
  updateWithOptimisticLock,
} from "@/db/lib/optimistic-locking.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import {
  sandboxProvider,
  SandboxProviderCredentialsPayloadSchema,
} from "@/db/schema/organizations.server"
import { LockVersionSchema, UuidV7Schema } from "@/lib/schemas"
import { runSandboxConnectionTest } from "./connection-test.server.ts"
import {
  SandboxCleanupFailed,
  SandboxConnectionFailed,
  SandboxProviderChanged,
  SandboxProviderInUse,
  SandboxProviderNameTaken,
  SandboxProviderNotFound,
  SandboxProviderUnreadable,
} from "./errors.ts"
import {
  decodeProviderOptions,
  type SandboxProviderCredentials,
  type SandboxProviderId,
  SandboxProviderIdSchema,
  SandboxProviderNameSchema,
  type SandboxProviderOptions,
  SandboxProviderOptionsSchema,
  type SandboxTestMetadata,
  SandboxTestMetadataSchema,
} from "./schemas.ts"

const SandboxProviderRowSchema = createSelectSchema(sandboxProvider, {
  id: UuidV7Schema,
  organizationId: UuidV7Schema,
  name: SandboxProviderNameSchema,
  providerType: SandboxProviderIdSchema,
  options: SandboxProviderOptionsSchema,
  lastTest: Schema.NullOr(SandboxTestMetadataSchema),
  lockVersion: LockVersionSchema,
}).mapFields(({ credentials: _credentials, ...fields }) => fields)

type SandboxProviderRow = typeof SandboxProviderRowSchema.Type

const decodeSandboxProviderRow = Schema.decodeUnknownEffect(SandboxProviderRowSchema, {
  onExcessProperty: "error",
})

const decodeSandboxProviderSummaries = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      id: UuidV7Schema,
      name: SandboxProviderNameSchema,
      providerType: SandboxProviderIdSchema,
      lastTest: Schema.NullOr(SandboxTestMetadataSchema),
    }),
  ),
  { onExcessProperty: "error" },
)

export type OrganizationSandboxProviderSummary = Effect.Success<
  ReturnType<typeof decodeSandboxProviderSummaries>
>[number]

/** A provider as its no-store editing page sees it, with credentials revealed for masking. */
export type OrganizationSandboxProvider = SandboxProviderRow & {
  credentials: SandboxProviderCredentials[SandboxProviderId]
  /** False when stored credentials no longer decrypt, so the member enters them again. */
  credentialsReadable: boolean
}

export interface SandboxProviderConfiguration {
  readonly name: string
  readonly provider: SandboxProviderId
  readonly options: SandboxProviderOptions[SandboxProviderId]
  readonly credentials: SandboxProviderCredentials[SandboxProviderId]
}

export interface SaveSandboxProviderInput<Provider extends SandboxProviderId = SandboxProviderId> {
  readonly organizationId: string
  readonly name: string
  readonly providerType: Provider
  readonly options: SandboxProviderOptions[Provider]
  readonly credentials: SandboxProviderCredentials[Provider]
  /** Null when creating, together with `lockVersion`. */
  readonly id: string | null
  readonly lockVersion: number | null
}

// The raw text bypasses the column codec, so an unreadable value degrades instead of failing.
const sandboxProviderColumns = {
  id: sandboxProvider.id,
  organizationId: sandboxProvider.organizationId,
  name: sandboxProvider.name,
  providerType: sandboxProvider.providerType,
  options: sandboxProvider.options,
  lastTest: sandboxProvider.lastTest,
  lockVersion: sandboxProvider.lockVersion,
  createdAt: sandboxProvider.createdAt,
  updatedAt: sandboxProvider.updatedAt,
  storedCredentials: sql<string | null>`${sandboxProvider.credentials}::text`,
}

/** Decrypts a row's own credentials. Values copied from another row or provider are unreadable. */
function readStoredCredentials(
  row: SandboxProviderRow,
  storedCredentials: string | null,
): Option.Option<SandboxProviderCredentials[SandboxProviderId]> {
  if (row.providerType === "docker")
    return storedCredentials === null ? Option.some({}) : Option.none()
  const decrypted = decryptDatabaseValue({
    storedValue: storedCredentials,
    schema: SandboxProviderCredentialsPayloadSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  if (Result.isFailure(decrypted)) return Option.none()
  const payload = decrypted.success.value
  return payload.sandboxProviderId === row.id &&
    payload.organizationId === row.organizationId &&
    payload.providerType === row.providerType
    ? Option.some(payload.credentials)
    : Option.none()
}

function credentialsPayload(input: {
  id: string
  organizationId: string
  provider: SandboxProviderId
  credentials: SandboxProviderCredentials[SandboxProviderId]
}) {
  return input.provider === "docker"
    ? null
    : {
        sandboxProviderId: input.id,
        organizationId: input.organizationId,
        providerType: input.provider,
        credentials: input.credentials,
      }
}

const mapSandboxProviderWriteErrors = mapDatabaseErrors({
  sandbox_provider_organization_id_name_uidx: () => new SandboxProviderNameTaken(),
})

export class SandboxProviders extends Context.Service<
  SandboxProviders,
  {
    /** The list page's read, which leaves credentials encrypted. */
    readonly listSummaries: (input: {
      readonly organizationId: string
    }) => Effect.Effect<readonly OrganizationSandboxProviderSummary[]>
    readonly get: (input: {
      readonly organizationId: string
      readonly id: string
    }) => Effect.Effect<OrganizationSandboxProvider | null>
    /** Tests changed connection settings before storing them, and returns the provider's ID. */
    readonly save: (
      input: SaveSandboxProviderInput,
    ) => Effect.Effect<
      string,
      | SandboxProviderChanged
      | SandboxProviderNameTaken
      | SandboxConnectionFailed
      | SandboxCleanupFailed
    >
    /** Tests a saved provider and records the outcome, which it returns rather than fails with. */
    readonly testConnection: (input: {
      readonly organizationId: string
      readonly id: string
      readonly lockVersion: number
    }) => Effect.Effect<SandboxTestMetadata, SandboxProviderChanged | SandboxProviderUnreadable>
    readonly remove: (input: {
      readonly organizationId: string
      readonly id: string
      readonly lockVersion: number
    }) => Effect.Effect<void, SandboxProviderChanged | SandboxProviderInUse>
    /** The configuration a chat run builds its sandbox from. */
    readonly resolveConfiguration: (input: {
      readonly organizationId: string
      readonly id: string
    }) => Effect.Effect<
      SandboxProviderConfiguration,
      SandboxProviderNotFound | SandboxProviderUnreadable
    >
  }
>()("astralbeam/sandboxes/SandboxProviders") {
  static readonly layerNoDeps = Layer.effect(
    SandboxProviders,
    Effect.gen(function* () {
      const db = yield* Database

      const readRow = Effect.fnUntraced(function* (organizationId: string, id: string) {
        const [stored] = yield* db
          .select(sandboxProviderColumns)
          .from(sandboxProvider)
          .where(
            and(eq(sandboxProvider.organizationId, organizationId), eq(sandboxProvider.id, id)),
          )
          .limit(1)
        if (!stored) return null
        const { storedCredentials, ...fields } = stored
        const row = yield* decodeSandboxProviderRow(fields)
        const options = yield* decodeProviderOptions(row.providerType, row.options)
        return {
          row: { ...row, options },
          credentials: readStoredCredentials(row, storedCredentials),
        }
      }, Effect.orDie)

      const listSummaries = Effect.fn("SandboxProviders.listSummaries")(function* (input: {
        organizationId: string
      }) {
        const rows = yield* db
          .select({
            id: sandboxProvider.id,
            name: sandboxProvider.name,
            providerType: sandboxProvider.providerType,
            lastTest: sandboxProvider.lastTest,
          })
          .from(sandboxProvider)
          .where(eq(sandboxProvider.organizationId, input.organizationId))
          .orderBy(asc(sandboxProvider.name), asc(sandboxProvider.id))
        return yield* decodeSandboxProviderSummaries(rows)
      }, Effect.orDie)

      const get = Effect.fn("SandboxProviders.get")(function* (input: {
        organizationId: string
        id: string
      }) {
        const found = yield* readRow(input.organizationId, input.id)
        if (!found) return null
        return {
          ...found.row,
          credentials: Option.getOrElse(found.credentials, () => ({})),
          credentialsReadable: Option.isSome(found.credentials),
        } satisfies OrganizationSandboxProvider
      })

      const nameTaken = Effect.fnUntraced(function* (input: SaveSandboxProviderInput) {
        const [row] = yield* db
          .select({ id: sandboxProvider.id })
          .from(sandboxProvider)
          .where(
            and(
              eq(sandboxProvider.organizationId, input.organizationId),
              eq(sandboxProvider.name, input.name),
              input.id ? ne(sandboxProvider.id, input.id) : undefined,
            ),
          )
          .limit(1)
          .pipe(Effect.orDie)
        return row !== undefined
      })

      const create = Effect.fnUntraced(function* (
        input: SaveSandboxProviderInput,
        lastTest: SandboxTestMetadata | null,
      ) {
        return yield* db
          .transaction((transaction) =>
            Effect.gen(function* () {
              const [created] = yield* transaction
                .insert(sandboxProvider)
                .values({
                  organizationId: input.organizationId,
                  name: input.name,
                  providerType: input.providerType,
                  options: input.options,
                  credentials: null,
                  lastTest,
                })
                .returning({ id: sandboxProvider.id })
              // Credentials embed the row's generated ID, so they are written once it exists.
              yield* transaction
                .update(sandboxProvider)
                .set({
                  credentials: credentialsPayload({
                    id: created!.id,
                    organizationId: input.organizationId,
                    provider: input.providerType,
                    credentials: input.credentials,
                  }),
                })
                .where(
                  and(
                    eq(sandboxProvider.organizationId, input.organizationId),
                    eq(sandboxProvider.id, created!.id),
                  ),
                )
              return created!.id
            }),
          )
          .pipe(mapSandboxProviderWriteErrors)
      })

      const save = Effect.fn("SandboxProviders.save")(function* (input: SaveSandboxProviderInput) {
        const existing = input.id ? yield* readRow(input.organizationId, input.id) : null
        if (
          existing ? input.lockVersion !== existing.row.lockVersion : input.lockVersion !== null
        ) {
          return yield* new SandboxProviderChanged()
        }
        if (input.id !== null && !existing) return yield* new SandboxProviderChanged()
        // Checked before the connection test, which creates a billable vendor sandbox.
        if (yield* nameTaken(input)) return yield* new SandboxProviderNameTaken()
        const credentialsChanged =
          !existing ||
          existing.row.providerType !== input.providerType ||
          Option.match(existing.credentials, {
            onNone: () => true,
            onSome: (stored) => !Equal.equals(stored, input.credentials),
          })
        const requiresTest =
          credentialsChanged || !Equal.equals(existing.row.options, input.options)
        const tested = requiresTest
          ? yield* runSandboxConnectionTest({
              provider: input.providerType,
              options: input.options,
              credentials: input.credentials,
            })
          : null
        if (tested?.status === "failure") {
          return yield* tested.errorCode === "cleanup_failed"
            ? new SandboxCleanupFailed()
            : new SandboxConnectionFailed()
        }
        const lastTest = tested ?? existing?.row.lastTest ?? null
        if (!existing) return yield* create(input, lastTest)
        const credentials = credentialsPayload({
          id: existing.row.id,
          organizationId: input.organizationId,
          provider: input.providerType,
          credentials: input.credentials,
        })
        yield* updateWithOptimisticLock({
          executor: db,
          table: sandboxProvider,
          id: existing.row.id,
          scope: eq(sandboxProvider.organizationId, input.organizationId),
          expectedLockVersion: existing.row.lockVersion,
          set: {
            name: input.name,
            providerType: input.providerType,
            options: input.options,
            lastTest,
            ...(credentials === null || credentialsChanged ? { credentials } : {}),
          },
        }).pipe(
          mapSandboxProviderWriteErrors,
          Effect.catchTag("OptimisticLockError", () => Effect.fail(new SandboxProviderChanged())),
        )
        return existing.row.id
      })

      const testConnection = Effect.fn("SandboxProviders.testConnection")(function* (input: {
        organizationId: string
        id: string
        lockVersion: number
      }) {
        const found = yield* readRow(input.organizationId, input.id)
        if (found?.row.lockVersion !== input.lockVersion) return yield* new SandboxProviderChanged()
        if (Option.isNone(found.credentials)) return yield* new SandboxProviderUnreadable()
        const result = yield* runSandboxConnectionTest({
          provider: found.row.providerType,
          options: found.row.options,
          credentials: found.credentials.value,
        })
        yield* updateWithOptimisticLock({
          executor: db,
          table: sandboxProvider,
          id: input.id,
          scope: eq(sandboxProvider.organizationId, input.organizationId),
          expectedLockVersion: input.lockVersion,
          set: { lastTest: result },
        }).pipe(
          mapDatabaseErrors(),
          Effect.catchTag("OptimisticLockError", () => Effect.fail(new SandboxProviderChanged())),
        )
        return result
      })

      const remove = Effect.fn("SandboxProviders.remove")(
        function* (input: { organizationId: string; id: string; lockVersion: number }) {
          yield* deleteWithOptimisticLock({
            executor: db,
            table: sandboxProvider,
            id: input.id,
            scope: eq(sandboxProvider.organizationId, input.organizationId),
            expectedLockVersion: input.lockVersion,
          })
        },
        mapDatabaseErrors({
          agent_organization_id_sandbox_provider_id_fk: () => new SandboxProviderInUse(),
        }),
        Effect.catchTag("OptimisticLockError", () => Effect.fail(new SandboxProviderChanged())),
      )

      const resolveConfiguration = Effect.fn("SandboxProviders.resolveConfiguration")(
        function* (input: { organizationId: string; id: string }) {
          const found = yield* readRow(input.organizationId, input.id)
          if (!found) return yield* new SandboxProviderNotFound()
          if (Option.isNone(found.credentials)) return yield* new SandboxProviderUnreadable()
          return {
            name: found.row.name,
            provider: found.row.providerType,
            options: found.row.options,
            credentials: found.credentials.value,
          } satisfies SandboxProviderConfiguration
        },
      )

      return SandboxProviders.of({
        listSummaries,
        get,
        save,
        testConnection,
        remove,
        resolveConfiguration,
      })
    }),
  )

  static readonly layer = SandboxProviders.layerNoDeps.pipe(Layer.provide(Database.layer))
}
