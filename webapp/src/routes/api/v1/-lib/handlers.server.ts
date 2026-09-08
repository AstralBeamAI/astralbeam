import { Effect, Layer, Option, Stream } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { createTenant, getTenant, listTenants, updateTenant } from "@/db/tenant.server"
import type { DatabasePage } from "@/db/lib/pagination.server"
import {
  createTenantUser,
  getTenantUser,
  listTenantUsers,
  updateTenantUser,
} from "@/db/tenant-user.server"
import { type RestPageQuery, type RestScope, restScope, TenantRestApi } from "./contract.server"
import { decodeRestCursor, encodeRestCursor, type RestCollection } from "./pagination.server"
import { RestFault, restFault } from "./responses.server"
import { effectDatabase, runDatabaseEffect } from "@/db"

function restPageOptions(
  query: RestPageQuery,
  collection: RestCollection,
  scope: RestScope,
) {
  const externalId = query["filter[external_id]"]
  return Effect.tryPromise({
    try: async () => ({
      pageSize: query.page_size ?? 20,
      backward: query.page_before !== undefined,
      externalId,
      cursor: await decodeRestCursor(query.page_after ?? query.page_before, collection, {
        ...scope,
        externalId,
      }),
    }),
    catch: (error) =>
      error instanceof RestFault ? error : restFault(500, "Pagination could not be completed."),
  })
}

async function restPage<T extends { id: string }>(
  page: DatabasePage<T>,
  collection: RestCollection,
  scope: RestScope,
  url: string,
  backward: boolean,
  externalId?: string,
) {
  const { items, nextPosition, previousPosition } = page
  const cursorFor = async (row: { id: string } | null | undefined) =>
    row ? await encodeRestCursor(row, collection, { ...scope, externalId }) : null
  const page_after = await cursorFor(backward ? previousPosition : nextPosition)
  const page_before = await cursorFor(backward ? nextPosition : previousPosition)
  const links = []
  for (
    const [parameter, cursor, relation] of [
      ["page_after", page_after, "next"],
      ["page_before", page_before, "prev"],
    ] as const
  ) {
    if (!cursor) continue
    const next = new URL(url, "http://localhost")
    next.searchParams.delete("page_after")
    next.searchParams.delete("page_before")
    next.searchParams.set(parameter, cursor)
    links.push(`<${next.pathname}${next.search}>; rel="${relation}"`)
  }
  const body = { items, page_after, page_before }
  const headers = links.length ? { Link: links.join(", ") } : {}
  return HttpApiSchema.withHeaders({ body, headers })
}
const tenantHandlers = HttpApiBuilder.group(
  TenantRestApi,
  "tenants",
  (handlers) =>
    handlers.handleAll({
      listTenants: Effect.fn(function* ({ query, request }) {
        const scope = yield* restScope
        const { pageSize, backward, cursor, externalId } = yield* restPageOptions(
          query,
          "tenants",
          scope,
        )
        const page = yield* listTenants(scope, {
          pageSize,
          position: cursor,
          backward,
          externalId,
          includePrevious: true,
        })
          .pipe(
            Stream.runHead,
            Effect.map(Option.getOrThrow),
          )
        return yield* Effect.promise(() =>
          restPage(page, "tenants", scope, request.url, backward, externalId)
        )
      }, Effect.orDie),
      getTenant: Effect.fn(function* ({ params }) {
        return yield* getTenant(yield* restScope, params.id)
      }, Effect.orDie),
      createTenant: Effect.fn(function* ({ payload }) {
        const row = yield* createTenant(yield* restScope, payload)
        return HttpApiSchema.withHeaders({
          body: row,
          headers: { Location: `/api/v1/tenants/${row.id}` },
        })
      }, Effect.orDie),
      updateTenant: Effect.fn(function* ({ params, payload }) {
        return yield* updateTenant(yield* restScope, params.id, payload)
      }, Effect.orDie),
    }),
)
const tenantUserHandlers = HttpApiBuilder.group(
  TenantRestApi,
  "tenant_users",
  (handlers) =>
    handlers.handleAll({
      listUsersForTenant: Effect.fn(function* ({ params, query, request }) {
        const scope = yield* restScope
        const tenantScope = { ...scope, tenantFilter: params.tenant_id }
        const { pageSize, backward, cursor, externalId } = yield* restPageOptions(
          query,
          "tenant_users",
          tenantScope,
        )
        const page = yield* listTenantUsers(scope, params.tenant_id, {
          pageSize,
          position: cursor,
          backward,
          externalId,
          includePrevious: true,
        }).pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        return yield* Effect.promise(() =>
          restPage(page, "tenant_users", tenantScope, request.url, backward, externalId)
        )
      }, Effect.orDie),
      getTenantUser: Effect.fn(function* ({ params }) {
        return yield* getTenantUser(yield* restScope, params.tenant_id, params.id)
      }, Effect.orDie),
      createTenantUser: Effect.fn(function* ({ params, payload }) {
        const row = yield* createTenantUser(yield* restScope, params.tenant_id, payload)
        return HttpApiSchema.withHeaders({
          body: row,
          headers: { Location: `/api/v1/tenants/${row.tenantId}/tenant_users/${row.id}` },
        })
      }, Effect.orDie),
      updateTenantUser: Effect.fn(function* ({ params, payload }) {
        return yield* updateTenantUser(yield* restScope, params.tenant_id, params.id, payload)
      }, Effect.orDie),
    }),
)

export const TenantRestHandlers = Layer.mergeAll(tenantHandlers, tenantUserHandlers)

// Borrow the existing ManagedRuntime service; this does not build another database pool.
export const RestDatabaseLayer = Layer.effect(
  effectDatabase,
  Effect.promise(() => runDatabaseEffect(effectDatabase)),
)
