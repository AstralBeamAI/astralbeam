import { and, asc, desc, eq, gt, ilike, lt, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

import { Database } from "@/db/database.server"
import {
  type DatabasePage,
  type DatabasePageOptions,
  databasePage,
} from "@/db/lib/pagination.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { tenant, tenantUser } from "@/db/schema/organizations.server"
import type { ChatPrincipal } from "@/lib/chat/types"
import { TenantExternalIdTaken, TenantNotFound, TenantUserNotFound } from "./errors.ts"
import type {
  TenantUserPatchSchema,
  TenantUserRecordSchema,
  TenantUserWriteSchema,
} from "./schemas.ts"
import {
  type TenantRecord,
  tenantRecordColumns,
  Tenants,
  type TenantScope,
  tenantSearchPattern,
} from "./tenants.server.ts"

export type TenantUserRecord = typeof TenantUserRecordSchema.Type

export interface TenantUserListInput extends DatabasePageOptions {
  readonly scope: TenantScope
  readonly tenantId: string
  readonly externalId?: string | undefined
  readonly search?: string | undefined
  readonly admin?: boolean | undefined
}

const tenantUserRecordColumns = {
  id: tenantUser.id,
  tenantId: tenantUser.tenantId,
  externalId: tenantUser.externalId,
  name: tenantUser.name,
  admin: tenantUser.admin,
  metadata: tenantUser.metadata,
  createdAt: tenantUser.createdAt,
  updatedAt: tenantUser.updatedAt,
}

function tenantUserWhere(scope: TenantScope, tenantId: string, id?: string) {
  return and(
    eq(tenantUser.organizationId, scope.organizationId),
    scope.tenantId === undefined
      ? undefined
      : scope.tenantId === null
        ? sql`false`
        : eq(tenantUser.tenantId, scope.tenantId),
    eq(tenantUser.tenantId, tenantId),
    id === undefined ? undefined : eq(tenantUser.id, id),
  )
}

export class TenantUsers extends Context.Service<
  TenantUsers,
  {
    /** Fails when the Tenant itself is missing or out of scope, and lists nothing else. */
    readonly list: (
      input: TenantUserListInput,
    ) => Effect.Effect<DatabasePage<TenantUserRecord>, TenantNotFound>
    readonly get: (input: {
      readonly scope: TenantScope
      readonly tenantId: string
      readonly id: string
    }) => Effect.Effect<TenantUserRecord, TenantUserNotFound>
    readonly create: (input: {
      readonly scope: TenantScope
      readonly tenantId: string
      readonly fields: typeof TenantUserWriteSchema.Type
    }) => Effect.Effect<TenantUserRecord, TenantNotFound | TenantExternalIdTaken>
    readonly update: (input: {
      readonly scope: TenantScope
      readonly tenantId: string
      readonly id: string
      readonly patch: typeof TenantUserPatchSchema.Type
    }) => Effect.Effect<TenantUserRecord, TenantUserNotFound>
    /**
     * Upserts the signed Tenant and TenantUser identity in one transaction. Omitted profile
     * fields and admin keep their stored values.
     */
    readonly syncCurrentUser: (input: {
      readonly principal: ChatPrincipal
    }) => Effect.Effect<{ readonly tenant: TenantRecord; readonly user: TenantUserRecord }>
  }
>()("astralbeam/tenants/TenantUsers") {
  static readonly layerNoDeps = Layer.effect(
    TenantUsers,
    Effect.gen(function* () {
      const db = yield* Database
      const tenants = yield* Tenants

      // A Tenant-scoped credential reaches only its own Tenant, without another query.
      const requireTenant = (scope: TenantScope, tenantId: string) =>
        scope.tenantId === undefined
          ? tenants.get({ scope, id: tenantId }).pipe(Effect.asVoid)
          : scope.tenantId?.toLowerCase() === tenantId.toLowerCase()
            ? Effect.void
            : Effect.fail(new TenantNotFound())

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
                position ? (backward ? lt : gt)(tenantUser.id, position.id) : undefined,
              ),
            )
            .orderBy((backward ? desc : asc)(tenantUser.id))
            .limit(limit)
            .pipe(mapDatabaseErrors()),
        )
      })

      const get = Effect.fn("TenantUsers.get")(function* (input: {
        scope: TenantScope
        tenantId: string
        id: string
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
        scope: TenantScope
        tenantId: string
        fields: typeof TenantUserWriteSchema.Type
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
        scope: TenantScope
        tenantId: string
        id: string
        patch: typeof TenantUserPatchSchema.Type
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

      const syncCurrentUser = Effect.fn("TenantUsers.syncCurrentUser")(function* (input: {
        principal: ChatPrincipal
      }) {
        const identity = input.principal.tenantUser
        const organizationId = input.principal.organization.id
        return yield* db.transaction((transaction) =>
          Effect.gen(function* () {
            const [customer] = yield* transaction
              .insert(tenant)
              .values({
                organizationId,
                externalId: identity.tenant.id,
                name: identity.tenant.name,
                metadata: identity.tenant.metadata,
              })
              .onConflictDoUpdate({
                target: [tenant.organizationId, tenant.externalId],
                set: {
                  name: identity.tenant.name,
                  metadata: identity.tenant.metadata,
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
                name: identity.name,
                metadata: identity.metadata,
                admin: identity.admin,
              })
              .onConflictDoUpdate({
                target: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.externalId],
                set: {
                  name: identity.name,
                  metadata: identity.metadata,
                  admin: identity.admin,
                  updatedAt: sql`now()`,
                },
              })
              .returning(tenantUserRecordColumns)
            return { tenant: customer!, user: user! }
          }),
        )
      }, mapDatabaseErrors())

      return TenantUsers.of({ list, get, create, update, syncCurrentUser })
    }),
  )

  static readonly layer = TenantUsers.layerNoDeps.pipe(
    Layer.provide([Tenants.layer, Database.layer]),
  )
}
