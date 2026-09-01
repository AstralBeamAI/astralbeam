import { and, asc, eq, getTableName, ne } from "drizzle-orm"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { type EffectDatabase, effectDatabase } from "@/db"
import {
  deleteWithOptimisticLock,
  OptimisticLockError,
  updateWithOptimisticLock,
} from "./lib/optimistic-locking.server.ts"
import {
  sandboxProvider,
  SandboxProviderCredentialsPayloadSchema,
} from "./schema/organizations.server.ts"
import {
  decodeProviderCredentials,
  decodeProviderOptions,
  SandboxConfigurationValidationError,
  type SandboxConnectionErrorCode,
  type SandboxProviderCredentials,
  type SandboxProviderId,
  SandboxProviderIdSchema,
  SandboxProviderNameSchema,
  type SandboxProviderOptions,
  SandboxProviderOptionsSchema,
  type SandboxTestMetadata,
  SandboxTestMetadataSchema,
} from "@/lib/sandbox/schemas"
import { LockVersionSchema, UuidV7Schema } from "@/lib/schemas"

type OrganizationSandboxProviderCandidate<Provider extends SandboxProviderId> = {
  name: string
  provider: Provider
  options: SandboxProviderOptions[Provider]
  credentials: SandboxProviderCredentials[Provider]
}

const SandboxProviderRowSchema = createSelectSchema(sandboxProvider, {
  id: UuidV7Schema,
  organizationId: UuidV7Schema,
  name: SandboxProviderNameSchema,
  providerType: SandboxProviderIdSchema,
  options: SandboxProviderOptionsSchema,
  credentials: Schema.NullOr(SandboxProviderCredentialsPayloadSchema),
  lastTest: Schema.NullOr(SandboxTestMetadataSchema),
  lockVersion: LockVersionSchema,
})
type SandboxProviderRow = typeof SandboxProviderRowSchema.Type

export type OrganizationSandboxProvider = Omit<SandboxProviderRow, "credentials"> & {
  credentials: SandboxProviderCredentials[SandboxProviderId]
}

type PreparedOrganizationSandboxProvider<Provider extends SandboxProviderId> = {
  organizationId: string
  candidate: OrganizationSandboxProviderCandidate<Provider>
  existing: SandboxProviderRow | null
  credentialsChanged: boolean
  requiresTest: boolean
}

class OrganizationSandboxProviderRepositoryError extends Data.TaggedError(
  "OrganizationSandboxProviderRepositoryError",
)<{ readonly cause: unknown }> {}

class SandboxProviderNameConflictError extends Data.TaggedError(
  "SandboxProviderNameConflictError",
)<{ readonly message: string }> {}

export function listOrganizationSandboxProviders(
  organizationId: string,
) {
  return sandboxProviderDatabaseEffect((db) =>
    db.select().from(sandboxProvider).where(eq(sandboxProvider.organizationId, organizationId))
      .orderBy(
        asc(sandboxProvider.name),
        asc(sandboxProvider.id),
      )
  ).pipe(
    Effect.flatMap((rows) =>
      Effect.forEach(
        rows,
        (row) => decodeSandboxProviderRow(row).pipe(Effect.flatMap(revealSandboxProviderRow)),
      )
    ),
  )
}

export function prepareOrganizationSandboxProviderCandidate<Provider extends SandboxProviderId>(
  input: SandboxProviderMutationInput<Provider>,
) {
  return Effect.gen(function* () {
    const name = yield* decodeSandboxProviderValue(() =>
      Schema.decodeUnknownSync(SandboxProviderNameSchema)(input.name)
    )
    const options = yield* decodeSandboxProviderValue(() =>
      decodeProviderOptions(input.providerType, input.options)
    )
    const existing = input.id ? yield* readSandboxProviderRow(input.organizationId, input.id) : null
    if (
      (!existing && (input.id !== undefined || input.lockVersion !== undefined)) ||
      (existing && input.lockVersion !== existing.lockVersion)
    ) {
      return yield* Effect.fail(
        new OptimisticLockError({
          reason: "conflict",
          expectedLockVersion: input.lockVersion ?? 0,
          tableName: getTableName(sandboxProvider),
        }),
      )
    }
    yield* ensureSandboxProviderNameAvailable(input.organizationId, name, input.id)
    const credentials = yield* decodeSandboxProviderValue(() =>
      decodeProviderCredentials(input.providerType, input.credentials)
    )
    const existingCredentials = existing && existing.providerType === input.providerType
      ? yield* readSandboxProviderCredentials(existing)
      : null
    const credentialsChanged = !existing || existing.providerType !== input.providerType ||
      JSON.stringify(existingCredentials) !== JSON.stringify(credentials)
    const requiresTest = credentialsChanged ||
      JSON.stringify(existing?.options) !== JSON.stringify(options)
    return {
      organizationId: input.organizationId,
      candidate: { name, provider: input.providerType, options, credentials },
      requiresTest,
      existing,
      credentialsChanged,
    } satisfies PreparedOrganizationSandboxProvider<Provider>
  })
}

export function saveOrganizationSandboxProvider<Provider extends SandboxProviderId>(
  prepared: PreparedOrganizationSandboxProvider<Provider>,
  testedAt?: string,
) {
  return Effect.gen(function* () {
    if (prepared.requiresTest && testedAt === undefined) {
      return yield* Effect.fail(
        new SandboxConfigurationValidationError({
          message: "Test the sandbox provider before saving these changes",
        }),
      )
    }
    const existing = prepared.existing
    const lastTest = testedAt
      ? { status: "success" as const, testedAt }
      : existing?.lastTest ?? null

    if (!existing) {
      return yield* createOrganizationSandboxProvider({
        organizationId: prepared.organizationId,
        candidate: prepared.candidate,
        lastTest,
      })
    }

    const db = yield* effectDatabase

    const credentialUpdate = prepared.candidate.provider === "docker"
      ? { credentials: null }
      : prepared.credentialsChanged
      ? {
        credentials: {
          sandboxProviderId: existing.id,
          organizationId: prepared.organizationId,
          providerType: prepared.candidate.provider,
          credentials: prepared.candidate.credentials,
        },
      }
      : {}
    yield* updateWithOptimisticLock({
      executor: db,
      table: sandboxProvider,
      id: existing.id,
      scope: eq(sandboxProvider.organizationId, prepared.organizationId),
      expectedLockVersion: existing.lockVersion,
      set: {
        name: prepared.candidate.name,
        providerType: prepared.candidate.provider,
        options: prepared.candidate.options,
        lastTest,
        ...credentialUpdate,
      },
    })
  })
}

export function resolveOrganizationSandboxProviderConfiguration(
  organizationId: string,
  sandboxProviderId: string,
) {
  return Effect.gen(function* () {
    const row = yield* readSandboxProviderRow(organizationId, sandboxProviderId)
    if (!row) {
      return yield* Effect.fail(
        new SandboxConfigurationValidationError({ message: "Sandbox provider not found" }),
      )
    }
    return {
      name: row.name,
      provider: row.providerType,
      options: row.options,
      credentials: yield* readSandboxProviderCredentials(row),
      id: row.id,
      lockVersion: row.lockVersion,
    }
  })
}

export function recordOrganizationSandboxProviderTest(input: {
  organizationId: string
  id: string
  lockVersion: number
  status: "success" | "failure"
  testedAt: string
  errorCode?: SandboxConnectionErrorCode
}) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    yield* updateWithOptimisticLock({
      executor: db,
      table: sandboxProvider,
      id: input.id,
      scope: eq(sandboxProvider.organizationId, input.organizationId),
      expectedLockVersion: input.lockVersion,
      set: {
        lastTest: {
          status: input.status,
          testedAt: input.testedAt,
          ...input.errorCode && { errorCode: input.errorCode },
        },
      },
    })
  })
}

export function deleteOrganizationSandboxProvider(input: {
  organizationId: string
  id: string
  lockVersion: number
}) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    yield* deleteWithOptimisticLock({
      executor: db,
      table: sandboxProvider,
      id: input.id,
      scope: eq(sandboxProvider.organizationId, input.organizationId),
      expectedLockVersion: input.lockVersion,
    })
  })
}

type SandboxProviderMutationInput<Provider extends SandboxProviderId> = {
  organizationId: string
  name: string
  providerType: Provider
  options: unknown
  credentials: unknown
  id?: string
  lockVersion?: number
}

function createOrganizationSandboxProvider<Provider extends SandboxProviderId>(input: {
  organizationId: string
  candidate: OrganizationSandboxProviderCandidate<Provider>
  lastTest: SandboxTestMetadata | null
}) {
  return sandboxProviderDatabaseEffect((db) =>
    db.transaction((transaction) =>
      Effect.gen(function* () {
        const createdRows = yield* transaction.insert(sandboxProvider).values({
          organizationId: input.organizationId,
          name: input.candidate.name,
          providerType: input.candidate.provider,
          options: input.candidate.options,
          credentials: null,
          lastTest: input.lastTest,
        }).returning()
        const created = createdRows[0]
        if (!created) {
          return yield* Effect.fail(
            new Error("PostgreSQL did not return the created sandbox provider"),
          )
        }
        if (input.candidate.provider === "docker") return created

        const rows = yield* transaction.update(sandboxProvider).set({
          credentials: {
            sandboxProviderId: created.id,
            organizationId: input.organizationId,
            providerType: input.candidate.provider,
            credentials: input.candidate.credentials,
          },
        }).where(eq(sandboxProvider.id, created.id)).returning()
        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            new Error("PostgreSQL did not return sandbox provider credentials"),
          )
        }
        return row
      })
    )
  ).pipe(Effect.asVoid)
}

function readSandboxProviderCredentials(
  row: SandboxProviderRow,
): Effect.Effect<
  SandboxProviderCredentials[SandboxProviderId],
  OrganizationSandboxProviderRepositoryError | SandboxConfigurationValidationError
> {
  if (row.providerType === "docker") {
    return row.credentials === null
      ? Effect.succeed({})
      : Effect.fail(storedSandboxProviderError("Docker unexpectedly has stored credentials"))
  }
  const payload = row.credentials
  if (!payload) {
    return Effect.fail(
      new SandboxConfigurationValidationError({
        message: "Provider credentials are not configured",
      }),
    )
  }
  if (
    payload.sandboxProviderId !== row.id || payload.organizationId !== row.organizationId ||
    payload.providerType !== row.providerType
  ) {
    return Effect.fail(storedSandboxProviderError("Stored credentials belong to another provider"))
  }
  return decodeSandboxProviderValue(() =>
    decodeProviderCredentials(row.providerType, payload.credentials)
  )
}

function revealSandboxProviderRow(row: SandboxProviderRow) {
  const { credentials: _storedCredentials, ...provider } = row
  return readSandboxProviderCredentials(row).pipe(
    Effect.map((credentials) => ({ ...provider, credentials })),
  )
}

function ensureSandboxProviderNameAvailable(
  organizationId: string,
  name: string,
  excludedId?: string,
) {
  return sandboxProviderDatabaseEffect((db) =>
    db.select({ id: sandboxProvider.id }).from(sandboxProvider).where(
      and(
        eq(sandboxProvider.organizationId, organizationId),
        eq(sandboxProvider.name, name),
        excludedId ? ne(sandboxProvider.id, excludedId) : undefined,
      ),
    ).limit(1)
  ).pipe(
    Effect.flatMap((rows) =>
      rows.length === 0 ? Effect.void : Effect.fail(
        new SandboxProviderNameConflictError({
          message: "A sandbox provider with this name already exists",
        }),
      )
    ),
  )
}

function readSandboxProviderRow(
  organizationId: string,
  id: string,
) {
  return sandboxProviderDatabaseEffect((db) =>
    db.select().from(sandboxProvider).where(
      and(eq(sandboxProvider.organizationId, organizationId), eq(sandboxProvider.id, id)),
    ).limit(1)
  ).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0]
      return row ? decodeSandboxProviderRow(row) : Effect.succeed(null)
    }),
  )
}

function storedSandboxProviderError(message: string): OrganizationSandboxProviderRepositoryError {
  return new OrganizationSandboxProviderRepositoryError({ cause: new Error(message) })
}

function sandboxProviderDatabaseEffect<Value>(
  operation: (db: EffectDatabase) => Effect.Effect<Value, unknown>,
) {
  return Effect.flatMap(effectDatabase, (db) =>
    operation(db).pipe(
      Effect.mapError((cause) => new OrganizationSandboxProviderRepositoryError({ cause })),
    ))
}

function decodeSandboxProviderValue<Value>(
  decode: () => Value,
): Effect.Effect<
  Value,
  OrganizationSandboxProviderRepositoryError | SandboxConfigurationValidationError
> {
  return Effect.try({
    try: decode,
    catch: (cause) =>
      cause instanceof SandboxConfigurationValidationError
        ? cause
        : new OrganizationSandboxProviderRepositoryError({ cause }),
  })
}

function decodeSandboxProviderRow(value: unknown) {
  return Schema.decodeUnknownEffect(
    SandboxProviderRowSchema,
    { onExcessProperty: "error" },
  )(value).pipe(
    Effect.flatMap((row) =>
      decodeSandboxProviderValue(() => ({
        ...row,
        options: decodeProviderOptions(row.providerType, row.options),
      }))
    ),
    Effect.mapError((cause) =>
      cause instanceof OrganizationSandboxProviderRepositoryError
        ? cause
        : new OrganizationSandboxProviderRepositoryError({ cause })
    ),
  )
}
