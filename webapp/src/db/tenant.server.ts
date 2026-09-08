import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm"
import { Data, Effect } from "effect"
import { effectDatabase } from "@/db"
import { tenant } from "@/db/schema/organizations.server"
import { sqlConstraint, sqlState } from "./lib/sqlstate.server"
import { type DatabasePageOptions, databasePages } from "./lib/pagination.server"
import type { TenantPatchSchema, TenantWriteSchema } from "@/api/management.ts"

export interface TenantScope {
  organizationId: string
  /** Omitted for organization-wide access; null means no accessible Tenant. */
  tenantId?: string | null
}

type TenantWrite = typeof TenantWriteSchema.Type
type TenantPatch = typeof TenantPatchSchema.Type
export interface TenantListOptions extends DatabasePageOptions {
  externalId?: string | undefined
}
export class TenantError extends Data.TaggedError("TenantError")<{
  reason: "NotFound" | "Conflict" | "Forbidden" | "Database"
  message: string
  cause?: { code: string | undefined }
}> {}

export function tenantDatabaseError(error: unknown) {
  if (error instanceof TenantError) return error
  const constraint = sqlConstraint(error)
  if (
    constraint === "tenant_organization_id_external_id_uidx" ||
    constraint === "tenant_user_organization_id_tenant_id_external_id_uidx"
  ) {
    return new TenantError({
      reason: "Conflict",
      message: "The external ID already exists in this scope.",
    })
  }
  if (constraint === "tenant_user_organization_id_tenant_id_fk") {
    return new TenantError({ reason: "NotFound", message: "Tenant not found." })
  }
  return new TenantError({
    reason: "Database",
    message: "The request could not be completed.",
    cause: { code: sqlState(error) },
  })
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

export function resolveTenant(organizationId: string, externalId: string) {
  return Effect.gen(function* () {
    const database = yield* effectDatabase
    const rows = yield* database.select({ id: tenant.id }).from(tenant).where(
      and(eq(tenant.organizationId, organizationId), eq(tenant.externalId, externalId)),
    ).limit(1)
    return rows[0]?.id ?? null
  }).pipe(Effect.mapError(tenantDatabaseError))
}

export function listTenants(
  scope: TenantScope,
  options: TenantListOptions = {},
) {
  const { backward = false, externalId } = options
  return databasePages(options, (position, pageSize) =>
    Effect.gen(function* () {
      const database = yield* effectDatabase
      return yield* database.select().from(tenant).where(
        and(
          tenantWhere(scope),
          externalId === undefined ? undefined : eq(tenant.externalId, externalId),
          position ? (backward ? lt : gt)(tenant.id, position.id) : undefined,
        ),
      ).orderBy((backward ? desc : asc)(tenant.id)).limit(pageSize + 1)
    }).pipe(Effect.mapError(tenantDatabaseError)))
}

export function getTenant(scope: TenantScope, id: string) {
  return Effect.gen(function* () {
    const database = yield* effectDatabase
    const rows = yield* database.select().from(tenant).where(
      tenantWhere(scope, id),
    ).limit(1)
    return rows[0]
  }).pipe(
    Effect.mapError(tenantDatabaseError),
    Effect.filterOrFail(
      (row) => row !== undefined,
      () => new TenantError({ reason: "NotFound", message: "Tenant not found." }),
    ),
  )
}

export function createTenant(scope: TenantScope, input: TenantWrite) {
  return Effect.gen(function* () {
    if (scope.tenantId !== undefined) {
      return yield* Effect.fail(
        new TenantError({
          reason: "Forbidden",
          message: "Tenant writes require organization scope.",
        }),
      )
    }
    const database = yield* effectDatabase
    const [row] = yield* database.insert(tenant).values({
      ...input,
      organizationId: scope.organizationId,
    }).returning()
    return row!
  }).pipe(Effect.mapError(tenantDatabaseError))
}

export function updateTenant(scope: TenantScope, id: string, patch: TenantPatch) {
  return Effect.gen(function* () {
    if (scope.tenantId !== undefined) {
      return yield* Effect.fail(
        new TenantError({
          reason: "Forbidden",
          message: "Tenant writes require organization scope.",
        }),
      )
    }
    const database = yield* effectDatabase
    const rows = yield* database.update(tenant).set(patch).where(tenantWhere(scope, id))
      .returning()
    return rows[0]
  }).pipe(
    Effect.mapError(tenantDatabaseError),
    Effect.filterOrFail(
      (row) => row !== undefined,
      () => new TenantError({ reason: "NotFound", message: "Tenant not found." }),
    ),
  )
}
