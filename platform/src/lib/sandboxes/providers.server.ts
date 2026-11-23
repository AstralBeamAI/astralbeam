import { and, eq, getTableColumns, sql } from "drizzle-orm"
import { Context, Effect, Equal, Layer, Result, Schema, Struct } from "effect"
import { SecureRandom } from "effect/crypto"

import { Database } from "@/db/database"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import { decryptDatabaseValue } from "@/db/lib/encryption"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { sandboxProvider, SandboxProviderCredentialsPayloadSchema } from "@/db/schema/organizations"
import { runSandboxConnectionTest } from "./connection-test.server.ts"
import { isSandboxProviderEnabled } from "./availability.server.ts"
import {
  SandboxCleanupFailed,
  SandboxConnectionFailed,
  SandboxProviderChanged,
  SandboxProviderInUse,
  SandboxProviderNameTaken,
  SandboxProviderNotFound,
  SandboxProviderUnreadable,
  SandboxProviderUnavailable,
} from "./errors.ts"
import {
  decodeProviderOptions,
  SandboxProviderConfigurationSchema,
  type SandboxProviderCredentials,
  type SandboxProviderId,
  type SandboxProviderOptions,
} from "./schemas.ts"

const decodeSandboxConfiguration = Schema.decodeUnknownResult(SandboxProviderConfigurationSchema, {
  onExcessProperty: "error",
})
const SandboxProviderRowSchema = sandboxProvider.schema.mapFields(Struct.omit(["credentials"]))

type SandboxProviderRow = typeof SandboxProviderRowSchema.Type

const decodeSandboxProviderRow = Schema.decodeUnknownEffect(SandboxProviderRowSchema, {
  onExcessProperty: "error",
})

const decodeSandboxProviderSummaries = Schema.decodeUnknownEffect(
  Schema.Array(
    SandboxProviderRowSchema.mapFields(Struct.pick(["id", "name", "providerType", "lastTest"])),
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

interface SaveSandboxProviderInput<Provider extends SandboxProviderId = SandboxProviderId> {
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
  ...Struct.omit(getTableColumns(sandboxProvider), ["credentials"]),
  // Discard legacy organization-selected images before the column codec decodes them.
  options: sql<unknown>`case when ${sandboxProvider.providerType} in ('docker', 'microsandbox') then '{}'::jsonb else ${sandboxProvider.options} end`,
  storedCredentials: sql<string | null>`${sandboxProvider.credentials}::text`,
}

/** Decrypts a row's own credentials. Values copied from another row or provider are unreadable. */
function readStoredCredentials(
  row: SandboxProviderRow,
  storedCredentials: string | null,
): SandboxProviderCredentials[SandboxProviderId] | null {
  if (row.providerType === "docker" || row.providerType === "microsandbox")
    return storedCredentials === null ? {} : null
  const decrypted = decryptDatabaseValue({
    storedValue: storedCredentials,
    schema: SandboxProviderCredentialsPayloadSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  if (Result.isFailure(decrypted)) return null
  const payload = decrypted.success.value
  return payload.sandboxProviderId === row.id &&
    payload.organizationId === row.organizationId &&
    payload.providerType === row.providerType
    ? payload.credentials
    : null
}

function credentialsPayload(input: SaveSandboxProviderInput & { id: string }) {
  return input.providerType === "docker" || input.providerType === "microsandbox"
    ? null
    : {
        sandboxProviderId: input.id,
        organizationId: input.organizationId,
        providerType: input.providerType,
        credentials: input.credentials,
      }
}

const mapSandboxProviderWriteErrors = mapDatabaseErrors({
  sandbox_provider_organization_id_name_uidx: () => new SandboxProviderNameTaken(),
})
const sandboxProviderChangedTags = ["NotFound", "StaleWrite"] as const

export class SandboxProviders extends Context.Service<SandboxProviders>()(
  "astralbeam/sandboxes/SandboxProviders",
  {
    make: Effect.gen(function* () {
      const db = yield* Database
      const useDatabase = Effect.provideService(Database, db)

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

      /** The list page's read, which leaves credentials encrypted. */
      const listSummaries = Effect.fn("SandboxProviders.listSummaries")(function* (input: {
        organizationId: string
      }) {
        const rows = yield* db.query.sandboxProvider.findMany({
          columns: { id: true, name: true, providerType: true, lastTest: true },
          where: { organizationId: input.organizationId },
          orderBy: { name: "asc", id: "asc" },
        })
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
          credentials: found.credentials ?? {},
          credentialsReadable: found.credentials !== null,
        } satisfies OrganizationSandboxProvider
      })

      /** Tests changed connection settings before storing them, and returns the provider's ID. */
      const save = Effect.fn("SandboxProviders.save")(function* (input: SaveSandboxProviderInput) {
        const existing = input.id ? yield* readRow(input.organizationId, input.id) : null
        if (
          input.id === null
            ? input.lockVersion !== null
            : !existing || input.lockVersion !== existing.row.lockVersion
        )
          return yield* new SandboxProviderChanged()
        if (
          Result.isFailure(
            decodeSandboxConfiguration(
              Struct.pick(input, ["providerType", "options", "credentials"]),
            ),
          )
        )
          return yield* Effect.die(new Error("Invalid sandbox provider configuration"))
        // Checked before the connection test, which creates a billable vendor sandbox.
        if (
          yield* db.query.sandboxProvider
            .findFirst({
              columns: { id: true },
              where: {
                organizationId: input.organizationId,
                name: input.name,
                ...(input.id ? { id: { ne: input.id } } : {}),
              },
            })
            .pipe(Effect.orDie)
        )
          return yield* new SandboxProviderNameTaken()
        const credentialsChanged =
          !existing ||
          existing.row.providerType !== input.providerType ||
          existing.credentials === null ||
          !Equal.equals(existing.credentials, input.credentials)
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
            : new SandboxConnectionFailed({ errorCode: tested.errorCode ?? "provider_error" })
        }
        const id = existing?.row.id ?? SecureRandom.uuidV7Unsafe()
        const credentials = credentialsPayload({ ...input, id })
        const fields = {
          name: input.name,
          providerType: input.providerType,
          options: input.options,
          lastTest: tested ?? existing?.row.lastTest ?? null,
        }
        const write = existing
          ? sandboxProvider.update(existing.row, {
              ...fields,
              ...(credentials === null || credentialsChanged ? { credentials } : {}),
            })
          : sandboxProvider.insert({
              id,
              organizationId: input.organizationId,
              ...fields,
              credentials,
            })
        yield* write.pipe(
          useDatabase,
          mapSandboxProviderWriteErrors,
          Effect.catchTag(sandboxProviderChangedTags, () => new SandboxProviderChanged()),
        )
        return id
      })

      /** Tests a saved provider and records the outcome, which it returns rather than fails with. */
      const testConnection = Effect.fn("SandboxProviders.testConnection")(function* (input: {
        organizationId: string
        id: string
        lockVersion: number
      }) {
        const found = yield* readRow(input.organizationId, input.id)
        if (found?.row.lockVersion !== input.lockVersion) return yield* new SandboxProviderChanged()
        if (found.credentials === null) return yield* new SandboxProviderUnreadable()
        const result = yield* runSandboxConnectionTest({
          provider: found.row.providerType,
          options: found.row.options,
          credentials: found.credentials,
        })
        yield* sandboxProvider.update(input, { options: found.row.options, lastTest: result }).pipe(
          useDatabase,
          mapDatabaseErrors(),
          Effect.catchTag(sandboxProviderChangedTags, () => new SandboxProviderChanged()),
        )
        return result
      })

      const remove = Effect.fn("SandboxProviders.remove")(
        function* (input: { organizationId: string; id: string; lockVersion: number }) {
          yield* sandboxProvider.delete(input)
        },
        useDatabase,
        mapDatabaseErrors({
          agent_organization_id_sandbox_provider_id_fk: () => new SandboxProviderInUse(),
        }),
        Effect.catchTag(sandboxProviderChangedTags, () => new SandboxProviderChanged()),
      )

      /** Enabled, readable configuration for chat and new sandbox-only attachments. */
      const resolveConfiguration = Effect.fn("SandboxProviders.resolveConfiguration")(
        function* (input: { organizationId: string; id: string }) {
          const found = yield* readRow(input.organizationId, input.id)
          if (!found) return yield* new SandboxProviderNotFound()
          if (!isSandboxProviderEnabled(found.row.providerType))
            return yield* new SandboxProviderUnavailable({
              cause: new Error("Sandbox provider is disabled on this server"),
            })
          if (found.credentials === null) return yield* new SandboxProviderUnreadable()
          return {
            name: found.row.name,
            provider: found.row.providerType,
            options: found.row.options,
            credentials: found.credentials,
          }
        },
      )

      return {
        listSummaries,
        get,
        save,
        testConnection,
        remove,
        resolveConfiguration,
      }
    }),
  },
) {
  static readonly layerNoDeps = Layer.effect(this, this.make)

  static readonly layer = SandboxProviders.layerNoDeps.pipe(Layer.provide(Database.layer))
}
