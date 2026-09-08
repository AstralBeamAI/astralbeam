import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm"
import { Effect, Stream } from "effect"
import { effectDatabase } from "@/db"
import { tenantUser } from "@/db/schema/organizations.server"
import { databasePages } from "./lib/pagination.server"
import type { TenantUserPatchSchema, TenantUserWriteSchema } from "@/api/management.ts"
import {
  getTenant,
  tenantDatabaseError,
  TenantError,
  type TenantListOptions,
  type TenantScope,
} from "./tenant.server"

type TenantUserWrite = typeof TenantUserWriteSchema.Type
type TenantUserPatch = typeof TenantUserPatchSchema.Type

function requireTenant(scope: TenantScope, tenantId: string) {
  if (scope.tenantId === undefined) return getTenant(scope, tenantId).pipe(Effect.asVoid)
  return scope.tenantId?.toLowerCase() === tenantId.toLowerCase()
    ? Effect.void
    : Effect.fail(new TenantError({ reason: "NotFound", message: "Tenant not found." }))
}

function tenantUserWhere(scope: TenantScope, tenantId?: string, id?: string) {
  return and(
    eq(tenantUser.organizationId, scope.organizationId),
    scope.tenantId === undefined
      ? undefined
      : scope.tenantId === null
      ? sql`false`
      : eq(tenantUser.tenantId, scope.tenantId),
    tenantId === undefined ? undefined : eq(tenantUser.tenantId, tenantId),
    id === undefined ? undefined : eq(tenantUser.id, id),
  )
}

export function listTenantUsers(
  scope: TenantScope,
  tenantId: string,
  options: TenantListOptions = {},
) {
  const { backward = false, externalId } = options
  return Stream.unwrap(Effect.gen(function* () {
    yield* requireTenant(scope, tenantId)
    return databasePages(options, (position, pageSize) =>
      Effect.gen(function* () {
        const database = yield* effectDatabase
        return yield* database.select().from(tenantUser).where(
          and(
            tenantUserWhere(scope, tenantId),
            externalId === undefined ? undefined : eq(tenantUser.externalId, externalId),
            position ? (backward ? lt : gt)(tenantUser.id, position.id) : undefined,
          ),
        )
          .orderBy((backward ? desc : asc)(tenantUser.id))
          .limit(pageSize + 1)
      }).pipe(Effect.mapError(tenantDatabaseError)))
  }))
}

export function getTenantUser(
  scope: TenantScope,
  tenantId: string,
  id: string,
) {
  return Effect.gen(function* () {
    const database = yield* effectDatabase
    const rows = yield* database.select().from(tenantUser).where(
      tenantUserWhere(scope, tenantId, id),
    ).limit(1)
    return rows[0]
  }).pipe(
    Effect.mapError(tenantDatabaseError),
    Effect.filterOrFail(
      (row) => row !== undefined,
      () => new TenantError({ reason: "NotFound", message: "Tenant user not found." }),
    ),
  )
}

export function createTenantUser(scope: TenantScope, tenantId: string, input: TenantUserWrite) {
  return Effect.gen(function* () {
    yield* requireTenant(scope, tenantId)
    const database = yield* effectDatabase
    const [row] = yield* database.insert(tenantUser).values({
      ...input,
      organizationId: scope.organizationId,
      tenantId,
    }).returning().pipe(Effect.mapError(tenantDatabaseError))
    return row!
  })
}

export function updateTenantUser(
  scope: TenantScope,
  tenantId: string,
  id: string,
  patch: TenantUserPatch,
) {
  return Effect.gen(function* () {
    const database = yield* effectDatabase
    const rows = yield* database.update(tenantUser).set(patch).where(
      tenantUserWhere(scope, tenantId, id),
    ).returning()
    return rows[0]
  }).pipe(
    Effect.mapError(tenantDatabaseError),
    Effect.filterOrFail(
      (row) => row !== undefined,
      () => new TenantError({ reason: "NotFound", message: "Tenant user not found." }),
    ),
  )
}
