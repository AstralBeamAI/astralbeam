import { and, asc, desc, eq, gt, ilike, lt, or, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { Context, Effect, Layer, Struct } from "effect"

import { Database } from "@/db/database"
import { type DatabasePageOptions, databasePage } from "@/db/lib/pagination"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import type { OrganizationId, TenantId } from "@/db/schema/organizations"
import { TenantIdSchema, tenant } from "@/db/schema/organizations"
import { TenantExternalIdTaken, TenantNotFound, TenantWriteForbidden } from "./errors.ts"
import { type TenantPatchSchema, TenantRecordSchema, type TenantWriteSchema } from "./schemas.ts"

/** The Tenants a verified credential may reach, derived from the credential and never the request. */
export interface TenantScope {
  readonly organizationId: OrganizationId
  /** Omitted for organization-wide access, and null means no accessible Tenant. */
  readonly tenantId?: TenantId | null | undefined
}

export type TenantRecord = typeof TenantRecordSchema.Type

export interface TenantListInput extends DatabasePageOptions {
  readonly scope: TenantScope
  readonly externalId?: string | undefined
  readonly search?: string | undefined
}

// A typed projection keeps the organization ID and future columns out of API records.
export const tenantRecordColumns = Struct.pick(tenant, Struct.keys(TenantRecordSchema.fields))
const tenantScopeColumns = { organizationId: tenant.organizationId, tenantId: tenant.id }

/** Escape LIKE wildcards so user input is a literal substring, not a pattern. */
export function tenantSearchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`
}

function tenantWhere(scope: TenantScope, id?: TenantId) {
  return and(
    tenantScopeWhere(scope, tenantScopeColumns),
    id === undefined ? undefined : eq(tenant.id, id),
  )
}

export function tenantScopeWhere(
  { organizationId, tenantId }: TenantScope,
  columns: Record<"organizationId" | "tenantId", AnyPgColumn>,
) {
  return and(
    eq(columns.organizationId, organizationId),
    tenantId === undefined
      ? undefined
      : tenantId === null
        ? sql`false`
        : eq(columns.tenantId, tenantId),
  )
}

function requireOrganizationScope(scope: TenantScope) {
  return scope.tenantId === undefined ? Effect.void : Effect.fail(new TenantWriteForbidden())
}

export class Tenants extends Context.Service<Tenants>()("astralbeam/tenants/Tenants", {
  make: Effect.gen(function* () {
    const db = yield* Database

    /** The internal ID of a Tenant identified by its customer-provided external ID. */
    const resolveId = Effect.fn("Tenants.resolveId")(function* (input: {
      readonly organizationId: OrganizationId
      readonly externalId: string
    }) {
      const row = yield* db.query.tenant.findFirst({ columns: { id: true }, where: input })
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
              position
                ? (backward ? lt : gt)(tenant.id, TenantIdSchema.make(position.id))
                : undefined,
            ),
          )
          .orderBy((backward ? desc : asc)(tenant.id))
          .limit(limit)
          .pipe(mapDatabaseErrors()),
      )
    })

    const get = Effect.fn("Tenants.get")(function* (input: {
      readonly scope: TenantScope
      readonly id: TenantId
    }) {
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
      readonly scope: TenantScope
      readonly fields: typeof TenantWriteSchema.Type
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
      readonly scope: TenantScope
      readonly id: TenantId
      readonly patch: typeof TenantPatchSchema.Type
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

    return { resolveId, list, get, create, update }
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make)

  static readonly layer = Tenants.layerNoDeps.pipe(Layer.provide(Database.layer))
}
