import { and, eq, notInArray, sql } from "drizzle-orm"
import { Context, Effect, Layer, Result } from "effect"
import { SecureRandom } from "effect/crypto"

import { Database } from "@/db/database"
import { Config } from "@/lib/config/config"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import { decryptDatabaseValue } from "@/db/lib/encryption"
import { deleteWithOptimisticLock, updateWithOptimisticLock } from "@/db/lib/optimistic-locking"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { DatabaseRateLimiter, hashedRateLimitKey } from "@/db/lib/rate-limiter"
import {
  agentModel,
  modelProvider,
  organizationConfiguration,
  providerModel,
} from "@/db/schema/organizations"
import { fetchPublicModelEndpoint, isPublicModelEndpointUrl } from "./endpoints.server.ts"
import { fetchWithTraceContext } from "@/lib/runtime/tracing-context.server"
import { formatAgentId } from "../agents/schemas.ts"
import {
  ModelProviderChanged,
  ModelProviderEndpointNotAllowed,
  ModelProviderInUse,
  ModelProviderKeyMissing,
  ModelProviderNameTaken,
  ModelProviderUnreadable,
  ModelProviderTestRateLimited,
  ModelConfigurationMissing,
} from "./errors.ts"
import { effectiveModelConfiguration, readModelPriceCatalog } from "./pricing-catalog.server.ts"
import type { ModelPriceCatalog } from "./pricing-catalog-schemas.ts"
import { testProviderModel } from "./test-model.server.ts"
import { modelWebAccess } from "./web.server"
import {
  ModelProviderCredentialsPayloadSchema,
  type ModelProviderFields,
  type ModelProviderApi,
  type ModelProviderType,
  type ModelConfiguration,
} from "./schemas.ts"

interface ModelProviderModel {
  readonly id: string
  readonly modelId: string
  readonly name: string
  readonly configuration: ModelConfiguration | null
}

export interface OrganizationModelProvider {
  readonly id: string
  readonly organizationId: string
  readonly name: string
  readonly providerType: ModelProviderType
  readonly api: ModelProviderApi
  readonly baseUrl: string
  readonly lockVersion: number
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly apiKeyHint: string | null
  readonly credentialsReadable: boolean
  readonly models: readonly ModelProviderModel[]
}

export type ModelProviderListItem = Omit<OrganizationModelProvider, "apiKeyHint" | "organizationId">

export interface ModelChoice extends Omit<ModelProviderModel, "configuration"> {
  readonly providerId: string
  readonly providerName: string
  readonly webAccess: boolean | null
}

export interface ChatModelConfiguration {
  readonly providerId: string
  readonly providerName: string
  readonly providerType: ModelProviderType
  readonly api: ModelProviderApi
  readonly baseUrl: string
  readonly apiKey: string
  readonly modelId: string
  /** The model's stored price and limit override, which `ModelProviders.pricing` completes. */
  readonly configured?: ModelConfiguration | null | undefined
  /** Enforces the deployment's private endpoint policy on every provider request. */
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

export type SaveModelProviderInput = ModelProviderFields & {
  readonly organizationId: string
  readonly id: string | null
  readonly lockVersion: number | null
}

type TestModelProviderInput = {
  readonly organizationId: string
  readonly id: string
  readonly lockVersion: number
  readonly modelId: string
}

const modelProviderColumns = {
  columns: { credentials: false },
  extras: {
    storedCredentials: (table: typeof modelProvider) =>
      sql<string | null>`${table.credentials}::text`,
  },
} as const

const modelProviderSelection = {
  ...modelProviderColumns,
  with: {
    models: {
      columns: { id: true, modelId: true, name: true, configuration: true },
      orderBy: { name: "asc", id: "asc" },
    },
  },
} as const

type StoredModelProvider = {
  readonly id: string
  readonly organizationId: string
  readonly providerType: ModelProviderType
  readonly storedCredentials: string | null
}

function readModelProviderKey(row: StoredModelProvider): string | null {
  const decoded = decryptDatabaseValue({
    storedValue: row.storedCredentials,
    schema: ModelProviderCredentialsPayloadSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  if (Result.isFailure(decoded)) return null
  const payload = decoded.success.value
  return payload.organizationId === row.organizationId &&
    payload.modelProviderId === row.id &&
    payload.providerType === row.providerType
    ? payload.apiKey
    : null
}

function publicProviderModels(
  row: Pick<OrganizationModelProvider, "providerType" | "models">,
  catalog: ModelPriceCatalog,
) {
  return row.models.map((model) => ({
    ...model,
    configuration: effectiveModelConfiguration({
      catalog,
      providerType: row.providerType,
      modelId: model.modelId,
      configured: model.configuration,
    }),
  }))
}

const mapModelProviderWriteErrors = mapDatabaseErrors({
  model_provider_organization_id_name_uidx: () => new ModelProviderNameTaken(),
  agent_model_provider_model_fk: () => new ModelProviderInUse(),
})

export class ModelProviders extends Context.Service<ModelProviders>()(
  "astralbeam/model-providers/ModelProviders",
  {
    make: Effect.gen(function* () {
      const db = yield* Database
      const config = yield* Config
      const rateLimiter = yield* DatabaseRateLimiter
      const readPricing = readModelPriceCatalog.pipe(Effect.provideService(Config, config))
      const allowsPrivateEndpoints = Effect.map(
        config.get("allow_private_model_endpoints"),
        (value) => value === "true",
      )

      // Names the agents still assigned a provider's models, other than those kept by a save.
      const failInUse = Effect.fnUntraced(function* (
        organizationId: string,
        modelProviderId: string,
        keptModelIds: string[],
      ) {
        const agents = yield* db.query.agent
          .findMany({
            columns: { name: true },
            where: {
              organizationId,
              models: {
                model: {
                  modelProviderId,
                  modelId: { notIn: keptModelIds },
                },
              },
            },
            orderBy: { name: "asc" },
          })
          .pipe(Effect.orDie)
        return yield* new ModelProviderInUse({
          agentNames: agents.slice(0, 3).map(({ name }) => name),
          agentCount: agents.length,
        })
      })

      const list = Effect.fn("ModelProviders.list")(function* (input: { organizationId: string }) {
        const catalog = yield* readPricing
        const rows = yield* db.query.modelProvider.findMany({
          ...modelProviderSelection,
          where: { organizationId: input.organizationId },
          orderBy: { name: "asc", id: "asc" },
        })
        return rows.map((stored) => {
          const {
            storedCredentials: _storedCredentials,
            organizationId: _organizationId,
            ...row
          } = stored
          return {
            ...row,
            credentialsReadable: readModelProviderKey(stored) !== null,
            models: publicProviderModels(row, catalog),
          }
        })
      }, Effect.orDie)

      const get = Effect.fn("ModelProviders.get")(function* (input: {
        organizationId: string
        id: string
      }) {
        const stored = yield* db.query.modelProvider.findFirst({
          ...modelProviderSelection,
          where: { organizationId: input.organizationId, id: input.id },
        })
        if (!stored) return null
        const { storedCredentials: _storedCredentials, ...row } = stored
        const catalog = yield* readPricing
        const apiKey = readModelProviderKey(stored)
        return {
          ...row,
          apiKeyHint: apiKey?.slice(-4) ?? null,
          credentialsReadable: apiKey !== null,
          models: publicProviderModels(row, catalog),
        }
      }, Effect.orDie)

      const choices = Effect.fn("ModelProviders.choices")(function* (input: {
        organizationId: string
      }) {
        const providers = yield* db.query.modelProvider.findMany({
          columns: { id: true, name: true, providerType: true, api: true, baseUrl: true },
          where: { organizationId: input.organizationId },
          orderBy: { name: "asc" },
          with: {
            models: {
              columns: { id: true, modelId: true, name: true },
              orderBy: { name: "asc", id: "asc" },
            },
          },
        })
        return providers.flatMap(({ id: providerId, name: providerName, models, ...provider }) =>
          models.map((model) => ({
            ...model,
            providerId,
            providerName,
            webAccess: modelWebAccess({ ...provider, modelId: model.modelId }),
          })),
        )
      }, Effect.orDie)

      const save = Effect.fn("ModelProviders.save")(function* (input: SaveModelProviderInput) {
        const existing =
          input.id === null
            ? null
            : yield* db.query.modelProvider
                .findFirst({
                  ...modelProviderColumns,
                  where: { organizationId: input.organizationId, id: input.id },
                })
                .pipe(Effect.orDie)
        if (
          input.id === null
            ? input.lockVersion !== null
            : !existing || existing.lockVersion !== input.lockVersion
        )
          return yield* new ModelProviderChanged()
        if (!(yield* allowsPrivateEndpoints) && !isPublicModelEndpointUrl(new URL(input.baseUrl)))
          return yield* new ModelProviderEndpointNotAllowed()
        // A stored key never follows its connection to another URL or provider type.
        const keyKept =
          existing?.baseUrl === input.baseUrl && existing.providerType === input.providerType
        const apiKey = input.apiKey ?? (keyKept ? readModelProviderKey(existing) : null)
        if (!apiKey)
          return yield* keyKept ? new ModelProviderUnreadable() : new ModelProviderKeyMissing()
        const inheritedModelIds =
          existing?.providerType === input.providerType
            ? input.models
                .filter((model) => model.configuration?.pricingSource.kind !== "manual")
                .map((model) => model.modelId)
            : []
        const savedModels = inheritedModelIds.length
          ? yield* db.query.providerModel
              .findMany({
                columns: { modelId: true, configuration: true },
                where: {
                  organizationId: input.organizationId,
                  modelProviderId: existing!.id,
                  modelId: { in: inheritedModelIds },
                },
              })
              .pipe(Effect.orDie)
          : []
        const catalog = yield* readPricing
        const configuredModels = input.models.map((model) => ({
          ...model,
          configuration: effectiveModelConfiguration({
            catalog,
            providerType: input.providerType,
            modelId: model.modelId,
            configured:
              model.configuration?.pricingSource.kind === "manual"
                ? model.configuration
                : savedModels.find(
                    (saved) =>
                      saved.modelId === model.modelId &&
                      saved.configuration?.pricingSource.kind === "catalog",
                  )?.configuration,
          }),
        }))
        if (configuredModels.some((model) => model.configuration === null))
          return yield* new ModelConfigurationMissing()
        const modelIds = configuredModels.map((model) => model.modelId)
        return yield* db
          .transaction((transaction) =>
            Effect.gen(function* () {
              const id = existing?.id ?? SecureRandom.uuidV7Unsafe()
              const fields = {
                name: input.name,
                providerType: input.providerType,
                api: input.api,
                baseUrl: input.baseUrl,
                credentials: {
                  organizationId: input.organizationId,
                  modelProviderId: id,
                  providerType: input.providerType,
                  apiKey,
                },
              }
              if (existing)
                yield* updateWithOptimisticLock({
                  executor: transaction,
                  table: modelProvider,
                  id,
                  scope: eq(modelProvider.organizationId, input.organizationId),
                  expectedLockVersion: existing.lockVersion,
                  set: fields,
                })
              else
                yield* transaction.insert(modelProvider).values({
                  id,
                  organizationId: input.organizationId,
                  ...fields,
                })
              yield* transaction
                .delete(providerModel)
                .where(
                  and(
                    eq(providerModel.organizationId, input.organizationId),
                    eq(providerModel.modelProviderId, id),
                    modelIds.length > 0 ? notInArray(providerModel.modelId, modelIds) : undefined,
                  ),
                )
              if (configuredModels.length > 0)
                yield* transaction
                  .insert(providerModel)
                  .values(
                    configuredModels.map((model) => ({
                      organizationId: input.organizationId,
                      modelProviderId: id,
                      ...model,
                    })),
                  )
                  .onConflictDoUpdate({
                    target: [
                      providerModel.organizationId,
                      providerModel.modelProviderId,
                      providerModel.modelId,
                    ],
                    set: {
                      name: sql`excluded.name`,
                      configuration: sql`excluded.configuration`,
                      updatedAt: sql`now()`,
                    },
                  })
              return id
            }),
          )
          .pipe(
            mapModelProviderWriteErrors,
            Effect.catchTags({
              OptimisticLockError: () => Effect.fail(new ModelProviderChanged()),
              ModelProviderInUse: () => failInUse(input.organizationId, existing!.id, modelIds),
            }),
          )
      })

      const remove = Effect.fn("ModelProviders.remove")(
        function* (input: { organizationId: string; id: string; lockVersion: number }) {
          yield* deleteWithOptimisticLock({
            executor: db,
            table: modelProvider,
            id: input.id,
            scope: eq(modelProvider.organizationId, input.organizationId),
            expectedLockVersion: input.lockVersion,
          })
        },
        mapDatabaseErrors({ agent_model_provider_model_fk: () => new ModelProviderInUse() }),
        Effect.catchTag("OptimisticLockError", () => Effect.fail(new ModelProviderChanged())),
        (effect, input) =>
          Effect.catchTag(effect, "ModelProviderInUse", () =>
            failInUse(input.organizationId, input.id, []),
          ),
      )

      const setupState = Effect.fn("ModelProviders.setupState")(function* (input: {
        organizationId: string
      }) {
        const defaultAgent = db
          .select({ id: organizationConfiguration.defaultAgentId })
          .from(organizationConfiguration)
          .where(eq(organizationConfiguration.organizationId, input.organizationId))
        const [state] = yield* db
          .select({
            providerCount: db.$count(
              modelProvider,
              eq(modelProvider.organizationId, input.organizationId),
            ),
            enabledModelCount: db.$count(
              providerModel,
              eq(providerModel.organizationId, input.organizationId),
            ),
            defaultAgentModelCount: db.$count(
              agentModel,
              and(
                eq(agentModel.organizationId, input.organizationId),
                eq(agentModel.agentId, defaultAgent),
              ),
            ),
            defaultAgentId: sql<string | null>`${defaultAgent}`,
          })
          .from(sql`(values (1)) as setup(value)`)
        return {
          ...state!,
          defaultAgentId: state!.defaultAgentId
            ? formatAgentId({ organizationId: input.organizationId, id: state!.defaultAgentId })
            : null,
        }
      }, Effect.orDie)

      const resolveForAgent = Effect.fn("ModelProviders.resolveForAgent")(function* (input: {
        organizationId: string
        agentId: string
      }) {
        const selected = yield* db.query.agentModel
          .findFirst({
            columns: {},
            where: { organizationId: input.organizationId, agentId: input.agentId },
            orderBy: { position: "asc" },
            with: {
              model: {
                columns: { modelId: true, configuration: true },
                with: { provider: modelProviderColumns },
              },
            },
          })
          .pipe(Effect.orDie)
        if (!selected?.model?.provider) return null
        const { modelId, configuration: configured, provider } = selected.model
        const apiKey = readModelProviderKey(provider)
        if (!apiKey) {
          yield* Effect.logWarning("Model provider key could not be read").pipe(
            Effect.annotateLogs({
              organizationId: input.organizationId,
              providerId: provider.id,
            }),
          )
          return yield* new ModelProviderUnreadable()
        }
        return {
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.providerType,
          api: provider.api,
          baseUrl: provider.baseUrl,
          modelId,
          configured,
          apiKey,
          fetch: (yield* allowsPrivateEndpoints) ? fetchWithTraceContext : fetchPublicModelEndpoint,
        }
      })

      const testModel = Effect.fn("ModelProviders.testModel")(function* (
        input: TestModelProviderInput,
      ) {
        const model = yield* db.query.providerModel
          .findFirst({
            columns: { modelId: true },
            where: {
              organizationId: input.organizationId,
              modelProviderId: input.id,
              id: input.modelId,
            },
            with: { provider: modelProviderColumns },
          })
          .pipe(Effect.orDie)
        const provider = model?.provider
        if (!model || provider?.lockVersion !== input.lockVersion)
          return yield* new ModelProviderChanged()
        const apiKey = readModelProviderKey(provider)
        if (!apiKey) return yield* new ModelProviderUnreadable()
        yield* rateLimiter
          .consume({
            key: hashedRateLimitKey("model-test", [input.organizationId]),
            limit: 5,
            window: "1 minute",
          })
          .pipe(
            Effect.catchReason(
              "RateLimiterError",
              "RateLimitExceeded",
              () => Effect.fail(new ModelProviderTestRateLimited()),
              (_reason, error) => Effect.die(error),
            ),
          )
        yield* testProviderModel({
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.providerType,
          api: provider.api,
          baseUrl: provider.baseUrl,
          modelId: model.modelId,
          apiKey,
          fetch: (yield* allowsPrivateEndpoints) ? fetchWithTraceContext : fetchPublicModelEndpoint,
        })
        const current = yield* db.query.modelProvider
          .findFirst({
            columns: { lockVersion: true },
            where: { organizationId: input.organizationId, id: input.id },
          })
          .pipe(Effect.orDie)
        if (current?.lockVersion !== input.lockVersion) return yield* new ModelProviderChanged()
      })

      /** A resolved model's effective rates, reading the shared catalog only without a manual override. */
      const pricing = Effect.fn("ModelProviders.pricing")(function* (
        model: Pick<ChatModelConfiguration, "providerType" | "modelId" | "configured">,
      ) {
        if (model.configured?.pricingSource.kind === "manual") return model.configured
        const { providerType, modelId, configured } = model
        return effectiveModelConfiguration({
          catalog: yield* readPricing,
          providerType,
          modelId,
          configured,
        })
      })

      return {
        pricing,
        list,
        get,
        choices,
        save,
        remove,
        setupState,
        resolveForAgent,
        testModel,
      }
    }),
  },
) {
  static readonly layerNoDeps = Layer.effect(this, this.make)

  static readonly layer = ModelProviders.layerNoDeps.pipe(
    Layer.provide([Database.layer, Config.layer, DatabaseRateLimiter.layer]),
  )
}
