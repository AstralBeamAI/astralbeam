import { Context, Duration, Effect, Option, Schema, Stream } from "effect"
import { RateLimiter } from "effect/unstable/persistence"
import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { type EffectDatabase, runDatabaseEffect } from "@/db"
import { createTenant, listTenants } from "@/db/tenant.server"
import { listTenantUsers } from "@/db/tenant-user.server"
import { organization } from "@/db/schema/organizations.server"

const restTestState = vi.hoisted(() => ({
  rows: [] as unknown[][],
  predicates: [] as SQL[],
  writes: [] as unknown[],
  order: [] as SQL[],
  limits: [] as number[],
  failure: undefined as unknown,
  keyRows: [] as { id: string }[],
  verify: vi.fn(),
  chat: vi.fn(),
  consume: vi.fn(),
}))

// Return queued driver results, not a second implementation of database filtering or constraints.
vi.mock("@/db", () => {
  const result = () =>
    Effect.suspend(() => {
      if (restTestState.failure) return Effect.fail(restTestState.failure)
      const rows = restTestState.rows.shift()
      if (!rows) throw new Error("Unexpected database operation")
      return Effect.succeed(rows)
    })
  const query = {
    table: undefined as unknown,
    from(table: unknown) {
      this.table = table
      return this
    },
    innerJoin() {
      return this
    },
    where(predicate: SQL) {
      restTestState.predicates.push(predicate)
      return this
    },
    orderBy(...order: SQL[]) {
      restTestState.order = order
      return this
    },
    limit(limit: number) {
      if (this.table === organization) return Effect.succeed(restTestState.keyRows)
      restTestState.limits.push(limit)
      return result()
    },
    values(value: unknown) {
      restTestState.writes.push(value)
      return this
    },
    set(value: unknown) {
      restTestState.writes.push(value)
      return this
    },
    returning: result,
  }
  const database = {
    select: () => ({ ...query }),
    insert: () => ({ ...query }),
    update: () => ({ ...query }),
  } as unknown as EffectDatabase
  const service = Context.Service<EffectDatabase>("REST test database")
  return {
    effectDatabase: service,
    runDatabaseEffect: <A, E>(effect: Effect.Effect<A, E, EffectDatabase>) =>
      Effect.runPromise(effect.pipe(Effect.provideService(service, database))),
  }
})
vi.mock("@/lib/auth.server", () => ({
  getAuth: () => Promise.resolve({ api: { verifyApiKey: restTestState.verify } }),
}))
vi.mock("@/routes/api/chat/-lib/auth.server", () => ({
  authenticateChatRequest: restTestState.chat,
  isChatAuthenticationError: (error: unknown) =>
    error instanceof Error && error.name === "ChatAuthenticationError",
}))
vi.mock("@/db/lib/rate-limiter.server", () => ({
  databaseRateLimiter: { consume: restTestState.consume },
}))

import { dispatchRestRequest, tenantRestWebHandler } from "./transport.server"
import { encodeRestCursor } from "./pagination.server"
import {
  RestApiErrorSchema,
  TenantRecordSchema,
  tenantRestPage,
  TenantUserRecordSchema,
  tenantUserRestPage,
} from "./contract.server"

const restOrgId = "019a0000-0000-7000-8000-000000000001"
const restTenantId = "019a0000-0000-7000-8000-000000000002"
const restUserId = "019a0000-0000-7000-8000-000000000003"
const restOtherId = "019a0000-0000-7000-8000-000000000004"
const restTestApiKey = `key_example_test_abo_${"A".repeat(64)}`
const restTenantRow = {
  organizationId: restOrgId,
  id: restTenantId,
  externalId: " Customer/東京 +?# ",
  name: null,
  metadata: { external_id: "preserved", camelKey: true },
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
}
const restUserRow = { ...restTenantRow, id: restUserId, tenantId: restTenantId, admin: false }
const restPrincipal = {
  organization: { id: restOrgId },
  tenantUser: { id: "caller-not-persisted", admin: true, tenant: { id: restTenantRow.externalId } },
}
function restRequest(path: string, init: RequestInit = {}) {
  return dispatchRestRequest(
    new Request(`http://localhost/api/v1${path}`, {
      ...init,
      headers: init.headers ?? { "X-API-Key": restTestApiKey },
    }),
  )
}
async function restJson<S extends Schema.Constraint>(
  schema: S,
  path: string,
  { query, json, ...init }: RequestInit & {
    query?: Record<string, string | number>
    json?: unknown
  } = {},
) {
  const search = query
    ? new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))
    : undefined
  const response = await restRequest(path + (search?.size ? `?${search}` : ""), {
    ...init,
    ...(json === undefined ? {} : {
      body: JSON.stringify(json),
      headers: { "X-API-Key": restTestApiKey, "Content-Type": "application/json" },
    }),
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const error = Schema.decodeUnknownSync(RestApiErrorSchema)(body)
    throw Object.assign(new Error(error.detail), { status: response.status, body: error })
  }
  return Schema.decodeUnknownSync(Schema.toEncoded(schema))(body)
}
function restLastPredicate() {
  return new PgDialect().sqlToQuery(restTestState.predicates.at(-1)!)
}

describe("REST API through the Effect Fetch handler", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv("DATABASE_ENCRYPTION_KEY", "rest-unit-test-key-not-for-deployment")
    Object.assign(restTestState, {
      rows: [],
      predicates: [],
      writes: [],
      order: [],
      limits: [],
      failure: undefined,
      keyRows: [{ id: restOrgId }],
    })
    restTestState.verify.mockResolvedValue({
      valid: true,
      key: { id: restOtherId, referenceId: restOrgId },
    })
    restTestState.chat.mockResolvedValue(restPrincipal)
    restTestState.consume.mockReturnValue(Effect.void)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })
  afterAll(() => tenantRestWebHandler.dispose())

  test("database callers get scoped pages and domain errors without the REST dispatcher", async () => {
    const scope = { organizationId: restOrgId, tenantId: restTenantId }
    const denied = await runDatabaseEffect(Effect.flip(createTenant(scope, { externalId: "new" })))
    expect(denied).toMatchObject({ _tag: "TenantError", reason: "Forbidden" })
    expect(restTestState.writes).toEqual([])

    restTestState.rows.push([restUserRow, { ...restUserRow, id: restOtherId }])
    const page = await runDatabaseEffect(
      listTenantUsers(scope, restTenantId, { pageSize: 1 }).pipe(
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      ),
    )
    expect(page).toEqual({
      items: [restUserRow],
      nextPosition: { id: restUserId },
      previousPosition: undefined,
    })
    expect(restLastPredicate().params).toEqual([restOrgId, restTenantId, restTenantId])

    const missing = await runDatabaseEffect(
      listTenantUsers(scope, restOtherId).pipe(
        Stream.runHead,
        Effect.flip,
      ),
    )
    expect(missing).toMatchObject({ _tag: "TenantError", reason: "NotFound" })
  })

  test.each([false, true])(
    "database page streams advance lazily (backward: %s)",
    async (backward) => {
      const rows = [restTenantRow, { ...restTenantRow, id: restUserId }, {
        ...restTenantRow,
        id: restOtherId,
      }]
      const ordered = backward ? rows.toReversed() : rows
      restTestState.rows.push(ordered, [ordered[2]!])
      const pages = await runDatabaseEffect(
        listTenants({ organizationId: restOrgId }, {
          pageSize: 2,
          backward,
        }).pipe(Stream.toAsyncIterableEffect),
      )
      expect(restTestState.limits).toEqual([])
      const collected = []
      for await (const page of pages) collected.push(page)
      expect(collected).toEqual([
        {
          items: backward ? ordered.slice(0, 2).reverse() : ordered.slice(0, 2),
          nextPosition: { id: restUserId },
          previousPosition: undefined,
        },
        { items: [ordered[2]], nextPosition: null, previousPosition: undefined },
      ])
      expect(restTestState.limits).toEqual([3, 3])
      expect(restLastPredicate().params).toEqual([restOrgId, restUserId])
      expect(restLastPredicate().sql).toContain(backward ? " < " : " > ")
    },
  )

  test("HTTP responses preserve wire records, exact filters and scoped partial writes", async () => {
    restTestState.rows.push([restTenantRow], [restTenantRow], [restTenantRow])
    const created = await restRequest("/tenants", {
      method: "POST",
      body: JSON.stringify({ external_id: restTenantRow.externalId }),
      headers: { "X-API-Key": restTestApiKey, "Content-Type": "application/json" },
    })
    expect(created.status).toBe(201)
    expect(created.headers.get("location")).toBe(`/api/v1/tenants/${restTenantId}`)
    expect(created.headers.get("cache-control")).toBe("no-store")
    const tenant: unknown = await created.json()
    expect(tenant).toMatchObject({
      id: restTenantId,
      external_id: restTenantRow.externalId,
      name: null,
      metadata: restTenantRow.metadata,
      created_at: "2026-09-01T00:00:00.000Z",
    })
    expect(tenant).not.toHaveProperty("organization_id")
    const filter = { "filter[external_id]": restTenantRow.externalId }
    const matches = await restJson(tenantRestPage, "/tenants", { query: filter })
    expect(matches.items).toEqual([tenant])
    expect(restLastPredicate().params).toEqual([restOrgId, restTenantRow.externalId])
    await restJson(TenantRecordSchema, `/tenants/${restTenantId}`, {
      method: "PATCH",
      json: { name: null, metadata: {} },
    })
    expect(restTestState.writes).toEqual([
      { externalId: restTenantRow.externalId, organizationId: restOrgId },
      { name: null, metadata: {} },
    ])
    expect(restLastPredicate().params).toEqual([restOrgId, restTenantId])
  })

  test("TenantUser updates preserve scope and lists accept exact filters", async () => {
    restTestState.rows.push([restUserRow])
    await restJson(TenantUserRecordSchema, `/tenants/${restTenantId}/tenant_users/${restUserId}`, {
      method: "PATCH",
      json: { admin: true },
    })
    expect(restTestState.writes.at(-1)).toEqual({ admin: true })
    expect(restLastPredicate().params).toEqual([restOrgId, restTenantId, restUserId])

    const filter = { "filter[external_id]": restUserRow.externalId }
    restTestState.rows.push([restTenantRow], [restUserRow])
    const users = await restJson(tenantUserRestPage, `/tenants/${restTenantId}/tenant_users`, {
      query: filter,
    })
    expect(users.items[0]).toMatchObject({ id: restUserId, external_id: restUserRow.externalId })
    expect(users).toMatchObject({ page_after: null, page_before: null })
    expect(restLastPredicate().params).toEqual([restOrgId, restTenantId, restUserRow.externalId])
    expect(restLastPredicate().sql).toContain('"tenant_user"."external_id" =')
  })

  test("filtered cursors allow page-size changes but reject filter changes", async () => {
    const filter = { "filter[external_id]": restTenantRow.externalId }
    const cursor = await encodeRestCursor(restTenantRow, "tenants", {
      organizationId: restOrgId,
      externalId: restTenantRow.externalId,
    })
    restTestState.rows.push([])
    const terminal = await restJson(tenantRestPage, "/tenants", {
      query: {
        ...filter,
        page_after: cursor,
        page_size: 100,
      },
    })
    expect(terminal).toEqual({ items: [], page_after: null, page_before: null })
    expect(restLastPredicate().params).toEqual([restOrgId, restTenantRow.externalId, restTenantId])
    await expect(restJson(tenantRestPage, "/tenants", {
      query: { "filter[external_id]": "other", page_after: cursor },
    })).rejects.toMatchObject({ status: 400 })
  })

  test("rejects invalid writes and returns safe database errors", async () => {
    const malformed = await restRequest("/tenants", {
      method: "POST",
      body: "{",
      headers: { "X-API-Key": restTestApiKey, "Content-Type": "application/json" },
    })
    expect(malformed.status).toBe(422)
    for (const body of [{}, { metadata: null }, { extra: true }]) {
      const rejected = restJson(TenantRecordSchema, `/tenants/${restTenantId}`, {
        method: "PATCH",
        json: body,
      })
      await expect(rejected).rejects.toMatchObject({ status: 422 })
      await expect(rejected).rejects.toHaveProperty("body.issues")
    }
    expect(restTestState.writes).toEqual([])
    await expect(
      restJson(TenantUserRecordSchema, `/tenants/${restTenantId}/tenant_users/${restUserId}`, {
        method: "PATCH",
        json: {
          admin: "private-input",
        },
      }),
    ).rejects.toMatchObject({
      body: { issues: [{ path: "body.admin", message: "Expected boolean" }] },
    })
    for (
      const constraint of [
        "tenant_organization_id_external_id_uidx",
        "tenant_user_organization_id_tenant_id_external_id_uidx",
      ]
    ) {
      restTestState.failure = { constraint }
      await expect(
        restJson(TenantUserRecordSchema, `/tenants/${restTenantId}/tenant_users/${restUserId}`, {
          method: "PATCH",
          json: { name: "value" },
        }),
      )
        .rejects.toMatchObject({ status: 409 })
    }
    const logged = vi.spyOn(console, "log").mockImplementation(() => {})
    restTestState.failure = Object.assign(new Error("private database details"), { code: "42P01" })
    await expect(restJson(TenantRecordSchema, `/tenants/${restTenantId}`)).rejects.toMatchObject({
      status: 500,
      message: "The request could not be completed.",
    })
    const diagnostic = JSON.stringify(logged.mock.calls)
    expect(diagnostic).toContain("getTenant")
    expect(diagnostic).toContain("42P01")
    expect(diagnostic).not.toContain("private database details")
    restTestState.failure = undefined
    restTestState.rows.push([])
    await expect(restJson(TenantRecordSchema, `/tenants/${restTenantId}`)).rejects.toMatchObject({
      status: 404,
    })
  })

  test("reads persisted identities beyond the write limit", async () => {
    const row = {
      ...restTenantRow,
      id: "019a0000-0000-4000-8000-000000000003",
      externalId: "x".repeat(256),
    }
    restTestState.rows.push([row], [row])
    const page = await restJson(tenantRestPage, "/tenants")
    expect(page.items[0]?.external_id).toBe(row.externalId)
    expect(await restJson(TenantRecordSchema, `/tenants/${row.id}`)).toMatchObject({ id: row.id })
    await expect(
      restJson(TenantRecordSchema, "/tenants", {
        method: "POST",
        json: { external_id: row.externalId },
      }),
    )
      .rejects.toMatchObject({ status: 422 })
  })

  test("key verification runs once and decorated ownership is cross-checked", async () => {
    restTestState.rows.push([], [])
    expect((await restRequest("/tenants")).status).toBe(200)
    await expect(restRequest("/tenants", {
      headers: { Authorization: `Bearer ${restTestApiKey}` },
    })).resolves.toMatchObject({ status: 200 })
    expect(restTestState.verify).toHaveBeenCalledTimes(2)
    expect(restTestState.verify).toHaveBeenLastCalledWith({
      body: { key: `abo_${"A".repeat(64)}` },
    })
    const ownership = new PgDialect().sqlToQuery(restTestState.predicates[0]!)
    expect(ownership.params).toEqual([restOrgId, "example", restOtherId, "test", "default"])
    restTestState.rows.push([], [])
    await expect(restRequest("/tenants", {
      headers: { "X-API-Key": restTestApiKey, Authorization: "Bearer other" },
    })).resolves.toMatchObject({ status: 200 })
    await expect(restRequest("/tenants", { headers: { Cookie: "session=not-a-credential" } }))
      .resolves.toMatchObject({ status: 401 })
    expect(restTestState.verify).toHaveBeenCalledTimes(3)
    restTestState.keyRows = []
    expect((await restRequest("/tenants")).status).toBe(401)
    restTestState.verify.mockResolvedValue({ valid: false, error: { code: "INVALID_API_KEY" } })
    expect((await restRequest("/tenants")).status).toBe(401)
  })

  test("JWT authority and missing identity handling do not depend on stored TenantUser admin", async () => {
    const headers = { Authorization: "Bearer signed-jwt" }
    restTestState.rows.push([{ id: restTenantId }], [restUserRow])
    expect(
      (await restRequest(`/tenants/${restTenantId}/tenant_users?filter[external_id]=user`, {
        headers,
      })).status,
    ).toBe(
      200,
    )
    expect(restLastPredicate().params).toEqual([restOrgId, restTenantId, restTenantId, "user"])
    restTestState.rows.push([{ id: restTenantId }])
    await expect(restRequest(`/tenants/${restTenantId}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: '{"name":"denied"}',
    })).resolves.toMatchObject({ status: 403 })
    restTestState.chat.mockResolvedValue({
      ...restPrincipal,
      tenantUser: { ...restPrincipal.tenantUser, admin: false },
    })
    expect((await restRequest(`/tenants/${restTenantId}/tenant_users`, { headers })).status).toBe(
      403,
    )
    expect(restTestState.writes).toEqual([])
    restTestState.chat.mockResolvedValue(restPrincipal)
    restTestState.rows.push([], [], [])
    expect(await (await restRequest("/tenants", { headers })).json()).toMatchObject({
      items: [],
      page_after: null,
    })
    expect(restLastPredicate().sql).toContain("false")
    await expect(restRequest(`/tenants/${restOtherId}/tenant_users`, { headers }))
      .resolves.toMatchObject({ status: 404 })
    expect(restTestState.verify).not.toHaveBeenCalled()
    restTestState.chat.mockRejectedValue(
      Object.assign(new Error("invalid signature"), { name: "ChatAuthenticationError" }),
    )
    expect((await restRequest(`/tenants/${restTenantId}/tenant_users`, { headers })).status).toBe(
      401,
    )
  })

  test("rate limits retain Retry-After and JWT buckets include the external Tenant and user", async () => {
    restTestState.verify.mockResolvedValue({
      valid: false,
      error: { code: "RATE_LIMITED", details: { tryAgainIn: 1501 } },
    })
    await expect(restJson(tenantRestPage, "/tenants", { query: {} })).rejects.toMatchObject({
      status: 429,
    })
    expect((await restRequest("/tenants")).headers.get("retry-after")).toBe("2")
    for (const tenant of ["customer-a", "customer-b"]) {
      restTestState.chat.mockResolvedValue({
        ...restPrincipal,
        tenantUser: { ...restPrincipal.tenantUser, tenant: { id: tenant } },
      })
      restTestState.rows.push([], [])
      await restRequest("/tenants", { headers: { Authorization: "Bearer signed-jwt" } })
    }
    const [first, second] = restTestState.consume.mock.calls.map(([options]) =>
      options as { key: string; limit: number; window: Duration.Duration }
    )
    expect(first!.key).not.toBe(second!.key)
    expect(first!.limit).toBe(100)
    expect(Duration.toMillis(first!.window)).toBe(300000)
    restTestState.consume.mockReturnValue(Effect.fail(
      new RateLimiter.RateLimiterError({
        reason: new RateLimiter.RateLimitExceeded({
          key: "test",
          limit: 100,
          remaining: 0,
          retryAfter: Duration.seconds(2),
        }),
      }),
    ))
    const limited = await restRequest("/tenants", {
      headers: { Authorization: "Bearer signed-jwt" },
    })
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("2")
  })

  test("keyset pages cap sizes, preserve reverse display order and bind nested cursors", async () => {
    restTestState.rows.push([restTenantRow], [restUserRow, { ...restUserRow, id: restOtherId }])
    const first = await restJson(tenantUserRestPage, `/tenants/${restTenantId}/tenant_users`, {
      query: { page_size: 1 },
    })
    expect(first.items.map((item) => item.id)).toEqual([restUserId])
    expect(first.page_after).toEqual(expect.any(String))
    expect(first.page_before).toBeNull()
    expect(restTestState.limits.at(-1)).toBe(2)
    restTestState.rows.push([restTenantRow], [{ ...restUserRow, id: restOtherId }], [restUserRow])
    const last = await restJson(tenantUserRestPage, `/tenants/${restTenantId}/tenant_users`, {
      query: { page_size: 1, page_after: first.page_after! },
    })
    expect(last.page_after).toBeNull()
    expect(last.page_before).toEqual(expect.any(String))
    restTestState.rows.push([restTenantRow], [restUserRow], [{ ...restUserRow, id: restOtherId }])
    const backward = await restJson(tenantUserRestPage, `/tenants/${restTenantId}/tenant_users`, {
      query: { page_size: 999, page_before: last.page_before! },
    })
    expect(backward.items.map((item) => item.id)).toEqual([restUserId])
    expect(backward.page_before).toBeNull()
    expect(backward.page_after).toEqual(first.page_after)
    expect(restTestState.limits.slice(-2)).toEqual([101, 1])
    expect(restLastPredicate().sql).toContain('"tenant_user"."id" >')
    expect(restLastPredicate().params).toEqual([restOrgId, restTenantId, restUserId])
    expect(restTestState.order.map((order) => new PgDialect().sqlToQuery(order).sql))
      .toEqual(['"tenant_user"."id" asc'])
    restTestState.rows.push(
      [restTenantRow],
      [{ ...restUserRow, id: restOtherId }, {
        ...restUserRow,
        id: "019a0000-0000-7000-8000-000000000005",
      }],
      [restUserRow],
    )
    const middle = await restRequest(
      `/tenants/${restTenantId}/tenant_users?page_size=1&page_after=${first.page_after}`,
    )
    const middlePage: unknown = await middle.json()
    expect(middlePage).toHaveProperty("page_after", expect.any(String))
    expect(middlePage).toHaveProperty("page_before", last.page_before)
    expect(middle.headers.get("link")).toContain('rel="next"')
    expect(middle.headers.get("link")).toContain('rel="prev"')
    await expect(
      restJson(tenantUserRestPage, `/tenants/${restOtherId}/tenant_users`, {
        query: { page_after: first.page_after! },
      }),
    )
      .rejects.toMatchObject({ status: 400 })
    restTestState.rows.push([])
    expect(await restJson(tenantRestPage, "/tenants", { query: {} })).toEqual({
      items: [],
      page_after: null,
      page_before: null,
    })
    for (const query of ["page_size=0", "page_after=x", "sort=id"]) {
      expect((await restRequest(`/tenants?${query}`)).status).toBe(400)
    }
  })
})
