import { and, asc, desc, eq, gt, ilike, lt, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

import { Database } from "@/db/database.server"
import {
  type DatabasePage,
  type DatabasePageOptions,
  databasePage,
} from "@/db/lib/pagination.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { tenant } from "@/db/schema/organizations.server"
import { TenantExternalIdTaken, TenantNotFound, TenantWriteForbidden } from "./errors.ts"
import type { TenantPatchSchema, TenantRecordSchema, TenantWriteSchema } from "./schemas.ts"

/** The Tenants a verified credential may reach, derived from the credential and never the request. */
export interface TenantScope {
  readonly organizationId: string
  /** Omitted for organization-wide access; null means no accessible Tenant. */
  readonly tenantId?: string | null | undefined
}

export type TenantRecord = typeof TenantRecordSchema.Type

export interface TenantListInput extends DatabasePageOptions {
  readonly scope: TenantScope
  readonly externalId?: string | undefined
  readonly search?: string | undefined
}

// A typed projection keeps the organization ID and future columns out of API records.
export const tenantRecordColumns = {
  id: tenant.id,
  externalId: tenant.externalId,
  name: tenant.name,
  metadata: tenant.metadata,
  createdAt: tenant.createdAt,
  updatedAt: tenant.updatedAt,
}

/** Escape LIKE wildcards so user input is a literal substring, not a pattern. */
export function tenantSearchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`
}

function tenantWhere(scope: TenantScope, id?: string) {
  return and(
    eq(tenant.organizationId, scope.organizationId),
    scope.tenantId === undefined
      ? undefined
      : scope.tenantId === null
        ? sql`false`
        : eq(tenant.id, scope.tenantId),
    id === undefined ? undefined : eq(tenant.id, id),
  )
}

function requireOrganizationScope(scope: TenantScope) {
  return scope.tenantId === undefined ? Effect.void : Effect.fail(new TenantWriteForbidden())
}

export class Tenants extends Context.Service<
  Tenants,
  {
    /** The internal ID of a Tenant identified by its customer-provided external ID. */
    readonly resolveId: (input: {
      readonly organizationId: string
      readonly externalId: string
    }) => Effect.Effect<string | null>
    readonly list: (input: TenantListInput) => Effect.Effect<DatabasePage<TenantRecord>>
    readonly get: (input: {
      readonly scope: TenantScope
      readonly id: string
    }) => Effect.Effect<TenantRecord, TenantNotFound>
    readonly create: (input: {
      readonly scope: TenantScope
      readonly fields: typeof TenantWriteSchema.Type
    }) => Effect.Effect<TenantRecord, TenantWriteForbidden | TenantExternalIdTaken>
    readonly update: (input: {
      readonly scope: TenantScope
      readonly id: string
      readonly patch: typeof TenantPatchSchema.Type
    }) => Effect.Effect<TenantRecord, TenantWriteForbidden | TenantNotFound>
  }
>()("astralbeam/tenants/Tenants") {
  static readonly layerNoDeps = Layer.effect(
    Tenants,
    Effect.gen(function* () {
      const db = yield* Database

      const resolveId = Effect.fn("Tenants.resolveId")(function* (input: {
        organizationId: string
        externalId: string
      }) {
        const [row] = yield* db
          .select({ id: tenant.id })
          .from(tenant)
          .where(
            and(
              eq(tenant.organizationId, input.organizationId),
              eq(tenant.externalId, input.externalId),
            ),
          )
          .limit(1)
        return row?.id ?? null
      }, mapDatabaseErrors())

      const list = Effect.fn("Tenants.list")(function* (input: TenantListInput) {
        const { scope, externalId, search } = input
        return yield* databasePage(input, (position, limit, backward) =>
          db
            .select(tenantRecordColumns)
            .from(tenant)
            .where(
              and(
                tenantWhere(scope),
                externalId === undefined ? undefined : eq(tenant.externalId, externalId),
                search
                  ? or(
                      ilike(tenant.name, tenantSearchPattern(search)),
                      ilike(tenant.externalId, tenantSearchPattern(search)),
                    )
                  : undefined,
                position ? (backward ? lt : gt)(tenant.id, position.id) : undefined,
              ),
            )
            .orderBy((backward ? desc : asc)(tenant.id))
            .limit(limit)
            .pipe(mapDatabaseErrors()),
        )
      })

      const get = Effect.fn("Tenants.get")(function* (input: { scope: TenantScope; id: string }) {
        const [row] = yield* db
          .select(tenantRecordColumns)
          .from(tenant)
          .where(tenantWhere(input.scope, input.id))
          .limit(1)
          .pipe(mapDatabaseErrors())
        if (!row) return yield* new TenantNotFound()
        return row
      })

      const create = Effect.fn("Tenants.create")(function* (input: {
        scope: TenantScope
        fields: typeof TenantWriteSchema.Type
      }) {
        yield* requireOrganizationScope(input.scope)
        const [row] = yield* db
          .insert(tenant)
          .values({ ...input.fields, organizationId: input.scope.organizationId })
          .returning(tenantRecordColumns)
          .pipe(
            mapDatabaseErrors({
              tenant_organization_id_external_id_uidx: () => new TenantExternalIdTaken(),
            }),
          )
        return row!
      })

      const update = Effect.fn("Tenants.update")(function* (input: {
        scope: TenantScope
        id: string
        patch: typeof TenantPatchSchema.Type
      }) {
        yield* requireOrganizationScope(input.scope)
        const [row] = yield* db
          .update(tenant)
          .set(input.patch)
          .where(tenantWhere(input.scope, input.id))
          .returning(tenantRecordColumns)
          .pipe(mapDatabaseErrors())
        if (!row) return yield* new TenantNotFound()
        return row
      })

      return Tenants.of({ resolveId, list, get, create, update })
    }),
  )

  static readonly layer = Tenants.layerNoDeps.pipe(Layer.provide(Database.layer))
}
