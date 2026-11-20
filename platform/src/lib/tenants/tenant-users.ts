import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, ne, or, sql } from "drizzle-orm"
import { BigDecimal, Context, DateTime, Effect, Layer, Schema, Struct } from "effect"

import { Database } from "@/db/database"
import { type DatabasePageOptions, databasePage } from "@/db/lib/pagination"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { chatMessage } from "@/db/schema/chat"
import type { TenantId, TenantUserId } from "@/db/schema/organizations"
import {
  TenantUserIdSchema,
  modelProvider,
  providerModel,
  tenant,
  tenantUser,
} from "@/db/schema/organizations"
import type { ChatPrincipal } from "@/lib/chat/types"
import { Config } from "@/lib/config/config"
import {
  effectiveModelConfiguration,
  readModelPriceCatalog,
} from "@/lib/model-providers/pricing-catalog.server"
import { ModelRequestUsageSchema, modelUsageCost } from "@/lib/model-providers/usage-cost"
import { TenantExternalIdTaken, TenantNotFound, TenantUserNotFound } from "./errors.ts"
import {
  type TenantUserPatchSchema,
  TenantUserRecordSchema,
  type TenantUserWriteSchema,
} from "./schemas.ts"
import {
  tenantRecordColumns,
  Tenants,
  type TenantScope,
  tenantScopeWhere,
  tenantSearchPattern,
} from "./tenants.ts"

export type TenantUserRecord = typeof TenantUserRecordSchema.Type

export interface TenantUserListInput extends DatabasePageOptions {
  readonly scope: TenantScope
  readonly tenantId: TenantId
  readonly externalId?: string | undefined
  readonly search?: string | undefined
  readonly admin?: boolean | undefined
}

interface TenantUserUsageInput {
  readonly scope: TenantScope
  readonly tenantId: TenantId
  readonly userIds: readonly TenantUserId[]
  readonly start: string
  readonly end: string
}

const tenantUserRecordColumns = Struct.pick(tenantUser, Struct.keys(TenantUserRecordSchema.fields))

function tenantUserWhere(scope: TenantScope, tenantId: TenantId, id?: TenantUserId) {
  return and(
    tenantScopeWhere(scope, tenantUser),
    eq(tenantUser.tenantId, tenantId),
    id === undefined ? undefined : eq(tenantUser.id, id),
  )
}

export class TenantUsers extends Context.Service<TenantUsers>()("astralbeam/tenants/TenantUsers", {
  make: Effect.gen(function* () {
    const db = yield* Database
    const tenants = yield* Tenants
    const config = yield* Config

    // A Tenant-scoped credential reaches only its own Tenant, without another query.
    const requireTenant = (scope: TenantScope, tenantId: TenantId) =>
      scope.tenantId === undefined
        ? tenants.get({ scope, id: tenantId }).pipe(Effect.asVoid)
        : scope.tenantId?.toLowerCase() === tenantId.toLowerCase()
          ? Effect.void
          : Effect.fail(new TenantNotFound())

    /** Fails when the Tenant itself is missing or out of scope, and lists nothing else. */
    const list = Effect.fn("TenantUsers.list")(function* (input: TenantUserListInput) {
      const { scope, tenantId, externalId, search, admin } = input
      yield* requireTenant(scope, tenantId)
      return yield* databasePage(input, (position, limit, backward) =>
        db
          .select(tenantUserRecordColumns)
          .from(tenantUser)
          .where(
            and(
              tenantUserWhere(scope, tenantId),
              externalId === undefined ? undefined : eq(tenantUser.externalId, externalId),
              search
                ? or(
                    ilike(tenantUser.name, tenantSearchPattern(search)),
                    ilike(tenantUser.externalId, tenantSearchPattern(search)),
                  )
                : undefined,
              admin === undefined ? undefined : eq(tenantUser.admin, admin),
              position
                ? (backward ? lt : gt)(tenantUser.id, TenantUserIdSchema.make(position.id))
                : undefined,
            ),
          )
          .orderBy((backward ? desc : asc)(tenantUser.id))
          .limit(limit)
          .pipe(mapDatabaseErrors()),
      )
    })

    const usage = Effect.fn("TenantUsers.usage")(function* (input: TenantUserUsageInput) {
      const { scope, tenantId, userIds, start, end } = input
      yield* requireTenant(scope, tenantId)
      const users = yield* db
        .select({ id: tenantUser.id })
        .from(tenantUser)
        .where(and(tenantUserWhere(scope, tenantId), inArray(tenantUser.id, userIds)))
        .orderBy(asc(tenantUser.id))
        .limit(userIds.length)
      if (users.length === 0) return { start, end, items: [] }
      const initiator = sql<TenantUserId>`${chatMessage.metadata}->'provenance'->>'initiatorTenantUserId'`
      const savedUsage = sql`${chatMessage.metadata}->'provenance'->'usage'`
      const savedCost = sql`case
          when ${savedUsage}->>'costUsd' ~ '^-?[0-9]+([.][0-9]+)?$'
            then (${savedUsage}->>'costUsd')::numeric
          when jsonb_typeof(${savedUsage}->'cost') = 'number'
            then (${savedUsage}->>'cost')::numeric
        end`
      const range = and(
        eq(chatMessage.organizationId, scope.organizationId),
        eq(chatMessage.tenantId, tenantId),
        eq(chatMessage.role, "assistant"),
        ne(chatMessage.state, "draft"),
        gte(chatMessage.createdAt, DateTime.toDateUtc(DateTime.makeUnsafe(start))),
        lt(chatMessage.createdAt, DateTime.toDateUtc(DateTime.makeUnsafe(end))),
      )
      const totals = yield* db
        .select({
          tenantUserId: initiator,
          cost: sql<string>`coalesce(sum(${savedCost}), 0)::text`,
          needsPricing: sql<boolean>`bool_or(${savedCost} is null)`,
        })
        .from(chatMessage)
        .where(
          and(
            range,
            inArray(
              initiator,
              users.map(({ id }) => id),
            ),
          ),
        )
        .groupBy(initiator)
      const costs = new Map<TenantUserId, BigDecimal.BigDecimal>(
        users.map(({ id }) => [id, BigDecimal.fromNumberUnsafe(0)]),
      )
      for (const total of totals)
        costs.set(total.tenantUserId, BigDecimal.fromStringUnsafe(total.cost))
      const unpriced = totals
        .filter((total) => total.needsPricing)
        .map((total) => total.tenantUserId)
      const catalog =
        unpriced.length > 0
          ? yield* readModelPriceCatalog.pipe(Effect.provideService(Config, config))
          : undefined
      const pricingByModel = new Map<string, ReturnType<typeof effectiveModelConfiguration>>()
      let cursor:
        | { tenantUserId: TenantUserId; createdAt: string; threadId: string; id: string }
        | undefined
      while (catalog) {
        const replies = yield* db
          .select({
            id: chatMessage.id,
            threadId: chatMessage.threadId,
            createdAt: sql<string>`${chatMessage.createdAt}::text`,
            tenantUserId: initiator,
            usage: sql<Schema.JsonObject | null>`${chatMessage.metadata}->'provenance'->'usage'`,
            providerId: modelProvider.id,
            providerType: modelProvider.providerType,
            modelId: providerModel.modelId,
            configuration: providerModel.configuration,
          })
          .from(chatMessage)
          .leftJoin(
            modelProvider,
            and(
              eq(modelProvider.organizationId, chatMessage.organizationId),
              sql`${modelProvider.id}::text = ${chatMessage.metadata}->'provenance'->>'providerId'`,
              eq(
                modelProvider.providerType,
                sql`${chatMessage.metadata}->'provenance'->>'providerType'`,
              ),
            ),
          )
          .leftJoin(
            providerModel,
            and(
              eq(providerModel.organizationId, chatMessage.organizationId),
              eq(providerModel.modelProviderId, modelProvider.id),
              eq(providerModel.modelId, sql`${chatMessage.metadata}->'provenance'->>'modelId'`),
            ),
          )
          .where(
            and(
              range,
              inArray(initiator, unpriced),
              sql`${savedCost} is null`,
              cursor
                ? sql`(${initiator}, ${chatMessage.createdAt}, ${chatMessage.threadId}, ${chatMessage.id}) > (${cursor.tenantUserId}, ${cursor.createdAt}::timestamptz, ${cursor.threadId}::uuid, ${cursor.id}::uuid)`
                : undefined,
            ),
          )
          .orderBy(
            asc(initiator),
            asc(chatMessage.createdAt),
            asc(chatMessage.threadId),
            asc(chatMessage.id),
          )
          .limit(5000)
        for (const {
          tenantUserId,
          usage,
          providerId,
          providerType,
          modelId,
          configuration,
        } of replies) {
          if (!providerType || !modelId || !Schema.is(ModelRequestUsageSchema)(usage)) continue
          const key = `${providerId}:${modelId}`
          let pricing = pricingByModel.get(key)
          if (pricing === undefined) {
            pricing = effectiveModelConfiguration({
              catalog,
              providerType,
              modelId,
              configured: configuration,
            })
            pricingByModel.set(key, pricing)
          }
          if (!pricing) continue
          const cost = BigDecimal.fromStringUnsafe(modelUsageCost(pricing, usage))
          costs.set(tenantUserId, BigDecimal.sum(costs.get(tenantUserId)!, cost))
        }
        if (replies.length < 5000) break
        cursor = replies.at(-1)!
      }
      return {
        start,
        end,
        items: Array.from(costs, ([tenantUserId, cost]) => ({
          tenantUserId,
          costUsd: BigDecimal.format(cost),
        })),
      }
    }, mapDatabaseErrors())

    const get = Effect.fn("TenantUsers.get")(function* (input: {
      readonly scope: TenantScope
      readonly tenantId: TenantId
      readonly id: TenantUserId
    }) {
      const [row] = yield* db
        .select(tenantUserRecordColumns)
        .from(tenantUser)
        .where(tenantUserWhere(input.scope, input.tenantId, input.id))
        .limit(1)
        .pipe(mapDatabaseErrors())
      if (!row) return yield* new TenantUserNotFound()
      return row
    })

    const create = Effect.fn("TenantUsers.create")(function* (input: {
      readonly scope: TenantScope
      readonly tenantId: TenantId
      readonly fields: typeof TenantUserWriteSchema.Type
    }) {
      yield* requireTenant(input.scope, input.tenantId)
      const [row] = yield* db
        .insert(tenantUser)
        .values({
          ...input.fields,
          organizationId: input.scope.organizationId,
          tenantId: input.tenantId,
        })
        .returning(tenantUserRecordColumns)
        .pipe(
          mapDatabaseErrors({
            tenant_user_organization_id_tenant_id_external_id_uidx: () =>
              new TenantExternalIdTaken(),
            tenant_user_organization_id_tenant_id_fk: () => new TenantNotFound(),
          }),
        )
      return row!
    })

    const update = Effect.fn("TenantUsers.update")(function* (input: {
      readonly scope: TenantScope
      readonly tenantId: TenantId
      readonly id: TenantUserId
      readonly patch: typeof TenantUserPatchSchema.Type
    }) {
      const [row] = yield* db
        .update(tenantUser)
        .set(input.patch)
        .where(tenantUserWhere(input.scope, input.tenantId, input.id))
        .returning(tenantUserRecordColumns)
        .pipe(mapDatabaseErrors())
      if (!row) return yield* new TenantUserNotFound()
      return row
    })

    /**
     * Upserts the signed Tenant and TenantUser identity in one transaction. Omitted profile
     * fields and admin keep their stored values.
     */
    const syncCurrentUser = Effect.fn("TenantUsers.syncCurrentUser")(function* (input: {
      readonly principal: ChatPrincipal
    }) {
      const identity = input.principal.tenantUser
      const organizationId = input.principal.organization.id
      const tenantFields = Struct.pick(identity.tenant, ["name", "metadata"])
      const userFields = Struct.pick(identity, ["name", "metadata", "admin"])
      return yield* db.transaction((transaction) =>
        Effect.gen(function* () {
          const [customer] = yield* transaction
            .insert(tenant)
            .values({
              organizationId,
              externalId: identity.tenant.id,
              ...tenantFields,
            })
            .onConflictDoUpdate({
              target: [tenant.organizationId, tenant.externalId],
              set: {
                ...tenantFields,
                updatedAt: sql`now()`,
              },
            })
            .returning(tenantRecordColumns)
          const [user] = yield* transaction
            .insert(tenantUser)
            .values({
              organizationId,
              tenantId: customer!.id,
              externalId: identity.id,
              ...userFields,
            })
            .onConflictDoUpdate({
              target: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.externalId],
              set: {
                ...userFields,
                updatedAt: sql`now()`,
              },
            })
            .returning(tenantUserRecordColumns)
          return { tenant: customer!, user: user! }
        }),
      )
    }, mapDatabaseErrors())

    return { list, usage, get, create, update, syncCurrentUser }
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make)

  static readonly layer = TenantUsers.layerNoDeps.pipe(
    Layer.provide([Tenants.layer, Database.layer, Config.layer]),
  )
}
