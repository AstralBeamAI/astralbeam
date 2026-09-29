import { OpenApi } from "effect/unstable/httpapi"
import { Context, Duration, Effect, Layer, Logger, Schema, Stream } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { RateLimiter } from "effect/unstable/persistence"
import type { SQL } from "drizzle-orm"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { PgDialect } from "drizzle-orm/pg-core"
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { Database, type EffectDatabase } from "@/db/database.server"
import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials.server"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { type AppAuth, Auth } from "@/lib/auth/auth.server"
import { OrganizationMembershipError } from "@/lib/auth/errors"
import { Config } from "@/lib/config/config.server"
import { Organizations } from "@/lib/organizations/organizations.server"
import { Chat } from "@/lib/chat/chat.server"
import { ChatSandboxes } from "@/lib/chat/sandbox.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { TenantUsers } from "@/lib/tenants/tenant-users.server"
import { Tenants } from "@/lib/tenants/tenants.server"
import { organization } from "@/db/schema/organizations.server"
import {
  createTenant as sdkCreateTenant,
  getChatFile as sdkGetChatFile,
  getCurrentUser as sdkGetCurrentUser,
  listTenants as sdkListTenants,
  listUsersForTenant as sdkListUsers,
  runChat as sdkRunChat,
  updateTenant as sdkUpdateTenant,
} from "../../../../../../sdk/src/api/index.ts"

const restTestState = vi.hoisted(() => ({
  rows: [] as (unknown[] | { fail: unknown })[],
  predicates: [] as SQL[],
  writes: [] as unknown[],
  order: [] as SQL[],
  limits: [] as number[],
  keyRows: [] as { id: string; name?: string; slug?: string }[],
  logs: [] as string[],
  verify: vi.fn(),
  setupState: vi.fn<() => Effect.Effect<{ setupComplete: boolean }>>(),
  chat: vi.fn(),
  organizationAuth: vi.fn(),
  consume: vi.fn<(options: { key: string }) => Effect.Effect<void, RateLimiter.RateLimiterError>>(),
  agent: vi.fn(),
  run: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("@/db/lib/database-credentials.server", async (original) => ({
  ...(await original<typeof import("@/db/lib/database-credentials.server")>()),
  getDatabaseBootstrapIssues: vi.fn(),
}))
vi.mock("@/lib/chat/auth.server", async (original) => {
  const { ChatAuthenticationError } = await import("@/lib/chat/errors")
  return {
    ...(await original<typeof import("@/lib/chat/auth.server")>()),
    authenticateChatRequest: (request: Request) =>
      Effect.tryPromise({
        try: () => restTestState.chat(request) as Promise<unknown>,
        catch: (error) =>
          error instanceof Error && error.name === "ChatAuthenticationError"
            ? new ChatAuthenticationError()
            : error,
      }),
  }
})
vi.mock("@/lib/auth/organization-token.server", () => ({
  ORGANIZATION_TOKEN_TYPE: "astralbeam-organization+jwt",
  authenticateOrganizationRequest: restTestState.organizationAuth,
}))

import { ApiV1Routes } from "./transport.server"
import { authenticateRestRequest } from "./auth.server"
import { ApiV1 } from "./contract.server"
import { RestApiErrorSchema } from "./shared.server"
import { TenantRecordSchema, tenantRestPage } from "./tenant.server"
import { TenantUserRecordSchema, tenantUserRestPage } from "./tenant-user.server"
import {
  ChatAgentNotFound,
  ChatArtifactUnavailable,
  ChatSandboxOperationFailed,
} from "@/lib/chat/errors"

// Return queued driver results, not a second implementation of database filtering or constraints.
function restTestDatabase(): EffectDatabase {
  const result = () =>
    Effect.suspend(() => {
      const rows = restTestState.rows.shift()
      if (!rows) throw new Error("Unexpected database operation")
      return "fail" in rows ? Effect.fail(rows.fail) : Effect.succeed(rows)
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
    onConflictDoUpdate() {
      return this
    },
    returning: result,
  }
  const database = {
    transaction: (run: (tx: unknown) => unknown) => run(database),
    select: () => ({ ...query }),
    insert: () => ({ ...query }),
    update: () => ({ ...query }),
  }
  return database as unknown as EffectDatabase
}

function queryFailure(cause: object) {
  return { fail: new EffectDrizzleQueryError({ query: "query", params: ["private"], cause }) }
}

const restTestServices = Layer.mergeAll(
  TenantUsers.layerNoDeps.pipe(Layer.provideMerge(Tenants.layerNoDeps)),
  Layer.succeed(
    DatabaseRateLimiter,
    DatabaseRateLimiter.of({
      consume: (options) =>
        restTestState
          .consume(options)
          .pipe(
            Effect.as({ delay: Duration.zero, limit: 1, remaining: 0, resetAfter: Duration.zero }),
          ),
      reset: () => Effect.void,
    }),
  ),
  Layer.succeed(SandboxProviders, {
    resolveConfiguration: () =>
      Effect.succeed({ name: "Test", provider: "docker", options: {}, credentials: {} }),
  } as unknown as Context.Service.Shape<typeof SandboxProviders>),
  // Chat's own behavior is tested beside it, and these cover its HTTP contract.
  Layer.succeed(Chat, {
    run: (input) => restTestState.run(input) as never,
    capabilities: (input) => restTestState.agent(input) as never,
  }),
  Layer.succeed(ChatSandboxes, {
    session: () => Effect.die("unused"),
    readArtifact: (ticket) => restTestState.readFile(ticket) as never,
  }),
  Organizations.layerNoDeps,
  Logger.layer([Logger.map(Logger.formatJson, (line) => restTestState.logs.push(line))]),
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.succeed(Database, restTestDatabase()),
      // Better Auth verifies API keys, and these cover how the transport treats its verdicts.
      Layer.succeed(Auth, {
        api: <A>(call: (api: AppAuth["api"]) => Promise<A>) =>
          Effect.promise(() =>
            call({ verifyApiKey: restTestState.verify } as unknown as AppAuth["api"]),
          ),
      } as unknown as Context.Service.Shape<typeof Auth>),
      Layer.succeed(Config, {
        setupState: Effect.suspend(() => restTestState.setupState()),
      } as unknown as Context.Service.Shape<typeof Config>),
    ),
  ),
)

const restWebHandler = HttpRouter.toWebHandler(
  ApiV1Routes.pipe(Layer.provideMerge(restTestServices), Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
)

function runRestEffect<A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof restTestServices>>) {
  return Effect.runPromise(effect.pipe(Effect.provide(restTestServices)))
}

const restOrgId = "019a0000-0000-7000-8000-000000000001"
const restTenantId = "019a0000-0000-7000-8000-000000000002"
const restUserId = "019a0000-0000-7000-8000-000000000003"
const restOtherId = "019a0000-0000-7000-8000-000000000004"
const restSdkFetch: typeof fetch = (input, init) => restWebHandler.handler(new Request(input, init))
const restTenantJwt = `${btoa(JSON.stringify({ typ: "astralbeam+jwt" }))}.e30.c2ln`
const restTestApiKey = `key_${restOrgId}_${restOtherId}_abo_${"A".repeat(64)}`
// Repositories project public columns, so queued rows carry no organization ID.
const restTenantRow = {
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
  return restWebHandler.handler(
    new Request(`http://localhost/api/v1${path}`, {
      ...init,
      headers: init.headers ?? { "X-API-Key": restTestApiKey },
    }),
  )
}
async function restJson<S extends Schema.Constraint>(
  schema: S,
  path: string,
  {
    query,
    json,
    ...init
  }: RequestInit & {
    query?: Record<string, string | number>
    json?: unknown
  } = {},
) {
  const search = query
    ? new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))
    : undefined
  const response = await restRequest(path + (search?.size ? `?${search}` : ""), {
    ...init,
    ...(json === undefined
      ? {}
      : {
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

afterAll(() => restWebHandler.dispose())

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "rest-unit-test-key-not-for-deployment")
  Object.assign(restTestState, {
    rows: [],
    predicates: [],
    writes: [],
    order: [],
    limits: [],
    logs: [],
    keyRows: [{ id: restOrgId }],
  })
  vi.mocked(getDatabaseBootstrapIssues).mockReturnValue([])
  restTestState.setupState.mockReturnValue(Effect.succeed({ setupComplete: true }))
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

describe("v1 router boundary", () => {
  test.each(["bootstrap", "setup"])(
    "preserves safe 503 with CORS/no-store for %s",
    async (kind) => {
      if (kind === "bootstrap") {
        vi.mocked(getDatabaseBootstrapIssues).mockReturnValue(["DATABASE_URL"])
      } else {
        restTestState.setupState.mockReturnValue(Effect.succeed({ setupComplete: false }))
      }
      const response = await restRequest("/chat")
      expect(response.status).toBe(503)
      expect(response.headers.get("retry-after")).toBe("10")
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(await response.json()).toMatchObject({
        status: 503,
        detail: "Server configuration required.",
      })
    },
  )
  test.each(["tenants", "chat", "chat/config", "chat/files"])(
    "%s preflight bypasses setup and authentication",
    async (path) => {
      const response = await restRequest(`/${path}`, { method: "OPTIONS" })
      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-max-age")).toBe("86400")
      expect(response.headers.get("access-control-allow-credentials")).toBeNull()
      expect(getDatabaseBootstrapIssues).not.toHaveBeenCalled()
      expect(restTestState.setupState).not.toHaveBeenCalled()
    },
  )
  test("unexpected setup failures log safe diagnostics once and answer a reference", async () => {
    restTestState.setupState.mockReturnValue(
      Effect.die(Object.assign(new Error("private connection details"), { code: "08006" })),
    )
    const response = await restRequest("/tenants")
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).not.toContain("private connection details")
    expect(restTestState.logs).toHaveLength(1)
    expect(restTestState.logs[0]).toContain('"sqlstate":"08006"')
    expect(restTestState.logs[0]).toContain((JSON.parse(body) as { reference: string }).reference)
    expect(restTestState.logs[0]).not.toContain("private connection details")
  })
  test("unknown paths answer a problem body with CORS", async () => {
    const response = await restRequest("/unknown")
    expect(response.status).toBe(404)
    expect(response.headers.get("content-type")).toContain("application/problem+json")
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
  })
})

describe("REST API through the Effect Fetch handler", () => {
  test("current-user synchronization provisions non-admin identities before chat and exposes only public fields", async () => {
    restTestState.chat.mockResolvedValue({
      ...restPrincipal,
      tenantUser: { ...restPrincipal.tenantUser, admin: false },
    })
    restTestState.rows.push([restTenantRow], [restUserRow])
    const current = await sdkGetCurrentUser({
      astralBeamToken: restTenantJwt,
      apiUrl: "http://localhost/api",
      fetchClient: restSdkFetch,
    })
    expect(current).toMatchObject({
      scope: "tenant",
      organization: { id: restOrgId },
      tenant: { id: restTenantId },
      user: { id: restUserId, admin: false },
    })
    expect(current).not.toHaveProperty("tenant.organizationId")
    expect(current).not.toHaveProperty("user.organization_id")
    expect(restTestState.writes).toHaveLength(2)
  })

  test("current-user organization viewers read fresh membership without identity writes", async () => {
    const token = `${btoa(JSON.stringify({ typ: "astralbeam-organization+jwt" }))}.e30.c2ln`
    const user = { id: restUserId, name: "Viewer", email: "viewer@example.com", role: "viewer" }
    restTestState.organizationAuth.mockReturnValue(
      Effect.succeed({ organizationId: restOrgId, currentUser: user }),
    )
    const options = {
      astralBeamToken: token,
      apiUrl: "http://localhost/api",
      fetchClient: restSdkFetch,
    }
    expect(await sdkGetCurrentUser(options)).toEqual({
      scope: "organization",
      organization: { id: restOrgId },
      user,
    })
    restTestState.organizationAuth.mockReturnValue(Effect.fail(new OrganizationMembershipError()))
    await expect(sdkGetCurrentUser(options)).rejects.toMatchObject({ status: 403 })
    expect(restTestState.writes).toHaveLength(0)
  })

  test("current-user rejects invalid credentials before writes", async () => {
    for (const headers of [
      { "x-api-key": restTestApiKey },
      { authorization: "Bearer malformed" },
      {},
    ]) {
      const response = await restRequest("/me", {
        method: "POST",
        headers,
      })
      expect(response.status).toBe(401)
    }
    restTestState.chat.mockRejectedValue(
      Object.assign(new Error("Revoked"), { name: "ChatAuthenticationError" }),
    )
    const revoked = await restRequest("/me", {
      method: "POST",
      headers: { authorization: `Bearer ${restTenantJwt}` },
    })
    expect(revoked.status).toBe(401)
    expect(restTestState.writes).toHaveLength(0)
  })

  test("current-user throttling and query rejection cannot write identities", async () => {
    const options = {
      method: "POST",
      headers: { authorization: `Bearer ${restTenantJwt}` },
    }
    expect((await restRequest("/me?tenant=other", options)).status).toBe(400)
    restTestState.consume.mockReturnValue(
      Effect.fail(
        new RateLimiter.RateLimiterError({
          reason: new RateLimiter.RateLimitExceeded({
            key: "current-user:test",
            limit: 100,
            remaining: 0,
            retryAfter: Duration.millis(1500),
          }),
        }),
      ),
    )
    const response = await restRequest("/me", options)
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("2")
    expect(restTestState.writes).toHaveLength(0)
  })

  test("generated SDK sends typed writes and consumes live cursor pages", async () => {
    const options = {
      apiKey: restTestApiKey,
      apiUrl: "http://localhost/api",
      fetchClient: restSdkFetch,
      headers: new Headers({ "Content-Type": "application/json" }),
    }
    restTestState.rows.push([restTenantRow], [{ ...restTenantRow, name: "Updated" }])
    const tenant = await sdkCreateTenant({ external_id: restTenantRow.externalId }, options)
    expect(tenant).toMatchObject({
      id: restTenantId,
      name: null,
      created_at: "2026-09-01T00:00:00.000Z",
    })
    expect(await sdkUpdateTenant(tenant.id, { name: "Updated" }, options)).toHaveProperty(
      "name",
      "Updated",
    )
    restTestState.rows.push([restTenantRow, { ...restTenantRow, id: restOtherId }])
    const first = await sdkListTenants({ page_size: 1 }, options)
    restTestState.rows.push([{ ...restTenantRow, id: restOtherId }], [restTenantRow])
    const second = await sdkListTenants({ page_size: 1, page_after: first.page_after! }, options)
    expect(second.items[0]?.id).toBe(restOtherId)
    restTestState.rows.push([restTenantRow], [{ ...restTenantRow, id: restOtherId }])
    const previous = await sdkListTenants({ page_before: second.page_before! }, options)
    expect(previous.items).toEqual(first.items)
    restTestState.rows.push([])
    await expect(sdkUpdateTenant(restOtherId, { name: null }, options)).rejects.toMatchObject({
      name: "AstralBeamApiError",
      status: 404,
      body: { status: 404 },
    })
  })

  test("chat streams for non-admin JWTs and cancellation reaches the producer", async () => {
    restTestState.chat.mockResolvedValue({
      ...restPrincipal,
      tenantUser: { ...restPrincipal.tenantUser, admin: false },
    })
    let stopped = false
    restTestState.run.mockReturnValue(
      Effect.succeed(
        Stream.make({ type: "RUN_STARTED", threadId: "thread", runId: "run" }).pipe(
          Stream.concat(Stream.never),
          Stream.ensuring(
            Effect.sync(() => {
              stopped = true
            }),
          ),
        ),
      ),
    )
    const response = await sdkRunChat(
      {
        threadId: "thread",
        runId: "run",
        messages: [],
        tools: [],
        context: [],
      },
      {
        astralBeamToken: restTenantJwt,
        apiUrl: "http://localhost/api",
        fetchClient: restSdkFetch,
      },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("cache-control")).toContain("no-store")
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("RUN_STARTED")
    await reader.cancel()
    await vi.waitFor(() => expect(stopped).toBe(true))
    expect(restTestState.consume.mock.calls[0]![0]).toHaveProperty("limit", 20)
    expect(restTestState.consume.mock.calls[0]![0]).toHaveProperty(
      "key",
      expect.stringMatching(/^chat:/),
    )
    expect(restTestState.verify).not.toHaveBeenCalled()
    expect(restTestState.predicates).toEqual([])
  })

  test("chat HTTP failures share v1 errors, CORS, challenges, and retry information", async () => {
    const headers = { Authorization: `Bearer ${restTenantJwt}`, "Content-Type": "application/json" }
    for (const [body, extra, status] of [
      ["{", {}, 400],
      ["{}", { "content-length": String(33 * 1024 * 1024) }, 413],
      ["{}", { "content-type": "text/plain" }, 415],
    ] as const) {
      const response = await restRequest("/chat", {
        method: "POST",
        headers: { ...headers, ...extra },
        body,
      })
      expect(response.status).toBe(status)
      expect(response.headers.get("content-type")).toContain("application/problem+json")
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
      expect(await response.json()).toMatchObject({ status })
    }
    restTestState.agent.mockReturnValue(Effect.fail(new ChatAgentNotFound()))
    const missing = await restRequest("/chat/config", { headers })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ detail: "Agent not found." })
    restTestState.chat.mockRejectedValue(
      Object.assign(new Error("private"), { name: "ChatAuthenticationError" }),
    )
    const unauthorized = await restRequest("/chat/config", { headers })
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get("www-authenticate")).toContain("Bearer")
    expect(await unauthorized.text()).not.toContain("private")
    restTestState.chat.mockResolvedValue(restPrincipal)
    restTestState.consume.mockReturnValue(
      Effect.fail(
        new RateLimiter.RateLimiterError({
          reason: new RateLimiter.RateLimitExceeded({
            key: "chat:test",
            limit: 20,
            remaining: 0,
            retryAfter: Duration.millis(1500),
          }),
        }),
      ),
    )
    const limited = await restRequest("/chat", { method: "POST", headers, body: "{}" })
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("2")
  })

  test("artifact tickets serve unchanged bytes and security headers without bearer auth", async () => {
    const bytes = new TextEncoder().encode("A published report")
    const ticket = "signed-ticket"
    restTestState.readFile.mockReturnValue(
      Effect.succeed({ bytes, mimeType: "text/plain", path: "/workspace/report.txt" }),
    )
    const response = await sdkGetChatFile(
      { ticket },
      {
        apiUrl: "http://localhost/api",
        fetchClient: restSdkFetch,
      },
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("A published report")
    expect(response.headers.get("content-disposition")).toContain("report.txt")
    expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("access-control-expose-headers")).toContain("Content-Disposition")
    expect(restTestState.chat).not.toHaveBeenCalled()
    expect(restTestState.verify).not.toHaveBeenCalled()
    restTestState.readFile.mockReturnValue(
      Effect.fail(new ChatArtifactUnavailable({ reason: "Changed" })),
    )
    const changed = await restRequest(`/chat/files?ticket=${ticket}`)
    expect(changed.status).toBe(404)
    expect(await changed.json()).toMatchObject({
      detail: "The file changed since it was published.",
    })
    const cause = Object.assign(new Error("private provider details"), {
      name: "FileReadError",
      code: "ENOENT",
    })
    restTestState.readFile.mockReturnValue(
      Effect.die(new ChatSandboxOperationFailed({ timedOut: false, cause })),
    )
    const failed = await restRequest(`/chat/files?ticket=${ticket}`)
    expect(failed.status).toBe(500)
    expect(restTestState.logs).toHaveLength(1)
    expect(restTestState.logs[0]).toContain('"operation":"getChatFile"')
    expect(restTestState.logs[0]).toContain('"type":"ChatSandboxOperationFailed"')
    expect(restTestState.logs[0]).toContain('"sqlstate":"ENOENT"')
    expect(restTestState.logs[0]).not.toContain("private provider details")
    expect(await failed.text()).not.toContain("private provider details")
  })

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

  test("generated search queries escape patterns and retain every ownership and admin predicate", async () => {
    const options = {
      apiKey: restTestApiKey,
      apiUrl: "http://localhost/api",
      fetchClient: restSdkFetch,
    }
    restTestState.rows.push([restTenantRow], [restTenantRow], [restUserRow])
    await sdkListTenants({ q: "  東京_%\\  " }, options)
    expect(restLastPredicate().params).toEqual([restOrgId, "%東京\\_\\%\\\\%", "%東京\\_\\%\\\\%"])
    await sdkListUsers(
      restTenantId,
      {
        q: "Ada",
        "filter[admin]": "false",
        "filter[external_id]": "u",
      },
      options,
    )
    expect(restLastPredicate().params).toEqual([
      restOrgId,
      restTenantId,
      "u",
      "%Ada%",
      "%Ada%",
      false,
    ])
    expect(restLastPredicate().sql).toContain(" ilike ")
    for (const path of [
      "/tenants?filter[admin]=true",
      `/tenants/${restTenantId}/tenant_users?filter[admin]=1`,
      `/tenants?q=${"a".repeat(256)}`,
      "/tenants?q=%00",
      `/tenants/${restTenantId}/tenant_users?q=%00`,
    ]) {
      expect((await restRequest(path)).status).toBe(400)
    }
  })

  test("organization JWTs scope the current user and rate bucket", async () => {
    const currentUser = {
      id: restUserId,
      name: "Operator",
      email: "operator@example.com",
      role: "developer",
    }
    const jwt = `${btoa(JSON.stringify({ typ: "astralbeam-organization+jwt" }))}.e30.c2ln`
    const headers = { Authorization: `Bearer ${jwt}` }
    for (const scope of [
      { organizationId: restOrgId, currentUser },
      {
        organizationId: restOrgId,
        currentUser: { ...currentUser, email: "renamed@example.com" },
      },
      { organizationId: restOtherId, currentUser },
    ]) {
      restTestState.organizationAuth.mockReturnValue(Effect.succeed(scope))
      restTestState.rows.push([])
      expect((await restRequest("/tenants", { headers })).status).toBe(200)
      expect(restLastPredicate().params).toEqual([scope.organizationId])
    }
    await expect(
      runRestEffect(
        authenticateRestRequest(new Request("https://example.test/api/v1/tenants", { headers })),
      ),
    ).resolves.toEqual({ organizationId: restOtherId, currentUser })
    expect(restTestState.chat).not.toHaveBeenCalled()
    const buckets = restTestState.consume.mock.calls.map(([call]) => call.key)
    expect(buckets[1]).toBe(buckets[0])
    expect(buckets[2]).not.toBe(buckets[0])
    await expect(
      runRestEffect(
        authenticateRestRequest(
          new Request("https://example.test/api/v1/tenants", {
            headers: { "X-API-Key": restTestApiKey },
          }),
        ),
      ),
    ).resolves.toEqual({ organizationId: restOrgId })
  })

  test("organization JWTs without membership are forbidden before accessing resources", async () => {
    restTestState.organizationAuth.mockReturnValue(Effect.fail(new OrganizationMembershipError()))
    const jwt = `${btoa(JSON.stringify({ typ: "astralbeam-organization+jwt" }))}.e30.c2ln`
    const response = await restRequest("/tenants", { headers: { Authorization: `Bearer ${jwt}` } })
    expect(response.status).toBe(403)
    expect(restTestState.predicates).toEqual([])
    expect(restTestState.writes).toEqual([])
    expect(restTestState.consume).not.toHaveBeenCalled()
  })

  test.each([
    ["owner", 200, 201],
    ["developer", 200, 201],
    ["viewer", 200, 403],
    ["viewer,developer", 200, 201],
    ["unknown", 403, 403],
  ] as const)(
    "organization role %s gates resource reads and writes",
    async (role, readStatus, writeStatus) => {
      restTestState.organizationAuth.mockReturnValue(
        Effect.succeed({
          organizationId: restOrgId,
          currentUser: { id: restUserId, name: "Operator", email: "operator@example.com", role },
        }),
      )
      const jwt = `${btoa(JSON.stringify({ typ: "astralbeam-organization+jwt" }))}.e30.c2ln`
      const headers = { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }
      restTestState.rows.push([restTenantRow], [restTenantRow], [restUserRow])
      expect((await restRequest("/tenants", { headers })).status).toBe(readStatus)
      expect(
        (
          await restRequest("/tenants", {
            headers,
            method: "POST",
            body: JSON.stringify({ external_id: "new" }),
          })
        ).status,
      ).toBe(writeStatus)
      expect(
        (
          await restRequest(`/tenants/${restTenantId}/tenant_users/${restUserId}`, {
            headers,
            method: "PATCH",
            body: JSON.stringify({ name: "Updated" }),
          })
        ).status,
      ).toBe(writeStatus === 201 ? 200 : 403)
      expect(restTestState.writes).toHaveLength(writeStatus === 201 ? 2 : 0)
      expect(restTestState.consume).toHaveBeenCalledTimes(3)
    },
  )

  test("organization authentication preserves safe database diagnostics without disclosing them", async () => {
    restTestState.organizationAuth.mockReturnValue(
      Effect.fail(Object.assign(new Error("private database details"), { code: "42P01" })),
    )
    const jwt = `${btoa(JSON.stringify({ typ: "astralbeam-organization+jwt" }))}.e30.c2ln`
    const response = await restRequest("/tenants", { headers: { Authorization: `Bearer ${jwt}` } })
    expect(response.status).toBe(500)
    const body = (await response.json()) as { detail: string; reference: string }
    expect(body.detail).toBe("The request could not be completed.")
    expect(restTestState.logs).toHaveLength(1)
    expect(restTestState.logs[0]).toContain('"sqlstate":"42P01"')
    expect(restTestState.logs[0]).toContain(body.reference)
    expect(restTestState.logs[0]).not.toContain("private database details")
    expect(restTestState.predicates).toEqual([])
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
    restTestState.rows.push(queryFailure({ constraint: "tenant_organization_id_external_id_uidx" }))
    await expect(
      restJson(TenantRecordSchema, "/tenants", { method: "POST", json: { external_id: "taken" } }),
    ).rejects.toMatchObject({ status: 409 })
    restTestState.rows.push(
      [restTenantRow],
      queryFailure({ constraint: "tenant_user_organization_id_tenant_id_external_id_uidx" }),
    )
    await expect(
      restJson(TenantUserRecordSchema, `/tenants/${restTenantId}/tenant_users`, {
        method: "POST",
        json: { external_id: "taken" },
      }),
    ).rejects.toMatchObject({ status: 409 })
    restTestState.rows.push(queryFailure({ code: "42P01", message: "private database details" }))
    await expect(restJson(TenantRecordSchema, `/tenants/${restTenantId}`)).rejects.toMatchObject({
      status: 500,
      message: "The request could not be completed.",
    })
    expect(restTestState.logs).toHaveLength(1)
    expect(restTestState.logs[0]).toContain('"operation":"getTenant"')
    expect(restTestState.logs[0]).toContain('"sqlstate":"42P01"')
    expect(restTestState.logs[0]).not.toContain("private database details")
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
    ).rejects.toMatchObject({ status: 422 })
  })

  test("key verification runs once and decorated ownership is cross-checked", async () => {
    restTestState.rows.push([], [])
    expect((await restRequest("/tenants")).status).toBe(200)
    await expect(
      restRequest("/tenants", {
        headers: { Authorization: `Bearer ${restTestApiKey}` },
      }),
    ).resolves.toMatchObject({ status: 200 })
    expect(restTestState.verify).toHaveBeenCalledTimes(2)
    expect(restTestState.verify).toHaveBeenLastCalledWith({
      body: { key: `abo_${"A".repeat(64)}` },
    })
    const ownership = new PgDialect().sqlToQuery(restTestState.predicates[0]!)
    expect(ownership.params).toEqual([restOrgId, restOrgId, restOtherId, restOtherId, "default"])
    restTestState.rows.push([], [])
    await expect(
      restRequest("/tenants", {
        headers: { "X-API-Key": restTestApiKey, Authorization: "Bearer other" },
      }),
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      restRequest("/tenants", { headers: { Cookie: "session=not-a-credential" } }),
    ).resolves.toMatchObject({ status: 401 })
    expect(restTestState.verify).toHaveBeenCalledTimes(3)
    restTestState.keyRows = []
    expect((await restRequest("/tenants")).status).toBe(401)
    restTestState.verify.mockResolvedValue({ valid: false, error: { code: "INVALID_API_KEY" } })
    expect((await restRequest("/tenants")).status).toBe(401)
  })

  test("rejects legacy API keys before verification", async () => {
    const credential = `key_example_test_abo_${"A".repeat(64)}`
    expect((await restRequest("/tenants", { headers: { "X-API-Key": credential } })).status).toBe(
      401,
    )
    expect(restTestState.verify).not.toHaveBeenCalled()
  })

  test("JWT authority and missing identity handling do not depend on stored TenantUser admin", async () => {
    const headers = { Authorization: `Bearer ${restTenantJwt}` }
    restTestState.rows.push([{ id: restTenantId }], [restUserRow])
    expect(
      (
        await restRequest(`/tenants/${restTenantId}/tenant_users?filter[external_id]=user`, {
          headers,
        })
      ).status,
    ).toBe(200)
    expect(restLastPredicate().params).toEqual([restOrgId, restTenantId, restTenantId, "user"])
    restTestState.rows.push([{ id: restTenantId }])
    await expect(
      restRequest(`/tenants/${restTenantId}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: '{"name":"denied"}',
      }),
    ).resolves.toMatchObject({ status: 403 })
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
    await expect(
      restRequest(`/tenants/${restOtherId}/tenant_users`, { headers }),
    ).resolves.toMatchObject({ status: 404 })
    expect(restTestState.verify).not.toHaveBeenCalled()
    restTestState.chat.mockRejectedValue(
      Object.assign(new Error("invalid signature"), { name: "ChatAuthenticationError" }),
    )
    expect((await restRequest(`/tenants/${restTenantId}/tenant_users`, { headers })).status).toBe(
      401,
    )
  })

  test("the organization endpoint names the key's organization and forbids tenant JWTs", async () => {
    restTestState.keyRows = [{ id: restOrgId, name: "Acme", slug: "acme" }]
    const response = await restRequest("/organization")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: restOrgId, name: "Acme", slug: "acme" })
    restTestState.rows.push([{ id: restTenantId }])
    const tenantResponse = await restRequest("/organization", {
      headers: { Authorization: `Bearer ${restTenantJwt}` },
    })
    expect(tenantResponse.status).toBe(403)
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
      await restRequest("/tenants", { headers: { Authorization: `Bearer ${restTenantJwt}` } })
    }
    const [first, second] = restTestState.consume.mock.calls.map(
      ([options]) => options as { key: string; limit: number; window: Duration.Duration },
    )
    expect(first!.key).not.toBe(second!.key)
    expect(first!.limit).toBe(100)
    expect(Duration.toMillis(first!.window)).toBe(300000)
    restTestState.consume.mockReturnValue(
      Effect.fail(
        new RateLimiter.RateLimiterError({
          reason: new RateLimiter.RateLimitExceeded({
            key: "test",
            limit: 100,
            remaining: 0,
            retryAfter: Duration.seconds(2),
          }),
        }),
      ),
    )
    const limited = await restRequest("/tenants", {
      headers: { Authorization: `Bearer ${restTenantJwt}` },
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
    expect(restTestState.order.map((order) => new PgDialect().sqlToQuery(order).sql)).toEqual([
      '"tenant_user"."id" asc',
    ])
    restTestState.rows.push(
      [restTenantRow],
      [
        { ...restUserRow, id: restOtherId },
        {
          ...restUserRow,
          id: "019a0000-0000-7000-8000-000000000005",
        },
      ],
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
    ).rejects.toMatchObject({ status: 400 })
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

describe("REST request boundaries", () => {
  test("OpenAPI keeps one shared Tenant record model", () => {
    const document = OpenApi.fromApi(ApiV1)
    expect(
      Object.keys(document.components.schemas).filter((name) => name.startsWith("TenantRecord")),
    ).toEqual(["TenantRecordEncoded"])
  })
})
