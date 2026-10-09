import { StoredFiles } from "@/lib/storage/stored-files.server"
import { ChatFiles } from "@/lib/chat/attachments/chat-files.server"
import { Uploads } from "@/lib/chat/attachments/uploads.server"
import { UploadClaimed, UploadConflict } from "@/lib/chat/attachments/errors"
import { Context, Duration, Effect, Layer, Logger, ManagedRuntime, Schema, Stream } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { SqlClient } from "effect/sql"
import { RateLimiter } from "effect/persistence"
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
import { Agents } from "@/lib/agents/agents.server"
import {
  ChatThreads,
  type ChatAdmission,
  type ThreadRecord,
  type MessageRecord,
  type ParticipantRecord,
} from "@/lib/chat/threads/threads.server"
import { ChatThreadNotFound, ChatIdentityNotSynchronized } from "@/lib/chat/threads/errors"
import { ChatSandboxes } from "@/lib/chat/sandbox/sandbox.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { TenantUsers } from "@/lib/tenants/tenant-users.server"
import { Tenants } from "@/lib/tenants/tenants.server"
import { organization } from "@/db/schema/organizations.server"
import {
  createTenant as sdkCreateTenant,
  cancelChatUpload as sdkCancelChatUpload,
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
  directoryList: vi.fn(),
  directorySnapshot: vi.fn(),
  directoryMessage: vi.fn(),
  threadCreate: vi.fn(),
  threadScope: vi.fn(),
  threadList: vi.fn(),
  thread: vi.fn(),
  threadSnapshot: vi.fn(),
  threadMessage: vi.fn(),
  threadParticipants: vi.fn(),
  threadSetParticipant: vi.fn(),
  threadResolveTools: vi.fn(),
  threadAdmission: vi.fn(),
  threadInterrupt: vi.fn(),
  appLayer: undefined as Layer.Layer<never> | undefined,
  appRuntime: undefined as ManagedRuntime.ManagedRuntime<never, never> | undefined,
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
vi.mock("@/lib/runtime/runtime.server", async (original) => ({
  ...(await original<typeof import("@/lib/runtime/runtime.server")>()),
  getAppLayer: () => restTestState.appLayer,
  getAppRuntime: () => restTestState.appRuntime,
}))
vi.mock("@/lib/auth/organization-token.server", () => ({
  ORGANIZATION_TOKEN_TYPE: "astralbeam-organization+jwt",
  authenticateOrganizationRequest: restTestState.organizationAuth,
}))

import { ApiV1Routes } from "./transport.server"
import { handleApiV1Request } from "./route.server"
import { authenticateRestRequest } from "./auth.server"
import { RestApiErrorSchema } from "./shared.server"
import { TenantRecordSchema, tenantRestPage } from "./tenant.server"
import { TenantUserRecordSchema, tenantUserRestPage } from "./tenant-user.server"
import {
  CHAT_CONTINUATION_RATE_LIMIT_MAX_REQUESTS,
  CHAT_MODEL_UNAVAILABLE_MESSAGE,
  CHAT_RATE_LIMIT_MAX_REQUESTS,
} from "@/lib/chat/constants.server"
import { ChatAgentNotFound } from "@/lib/chat/errors"
import { ChatArtifactUnavailable, ChatSandboxOperationFailed } from "@/lib/chat/sandbox/errors"

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
  Layer.succeed(StoredFiles, {} as typeof StoredFiles.Service),
  ChatFiles.layer.pipe(Layer.orDie),
  Uploads.layer.pipe(Layer.orDie),
  Layer.succeed(SqlClient.SqlClient, {} as typeof SqlClient.SqlClient.Service),
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
    readHistoricalArtifact: () => Effect.die("unused"),
    readArtifact: (ticket) => restTestState.readFile(ticket) as never,
  }),
  Layer.succeed(Agents, {
    resolveForChat: () =>
      Effect.succeed({ id: restOtherId, attachmentsEnabled: true, sandboxProviderId: null }),
  } as unknown as typeof Agents.Service),
  Layer.succeed(ChatThreads, {
    directoryList: (input: unknown) => restTestState.directoryList(input) as never,
    directorySnapshot: (input: unknown) => restTestState.directorySnapshot(input) as never,
    directoryMessage: (input: unknown) => restTestState.directoryMessage(input) as never,
    create: (input: unknown) => restTestState.threadCreate(input) as never,
    resolveScope: (input: unknown) => restTestState.threadScope(input) as never,
    list: (input: unknown) => restTestState.threadList(input) as never,
    get: (input: unknown) => restTestState.thread(input) as never,
    snapshot: (input: unknown) => restTestState.threadSnapshot(input) as never,
    getMessage: (input: unknown) => restTestState.threadMessage(input) as never,
    participants: (input: unknown) => restTestState.threadParticipants(input) as never,
    setParticipant: (input: unknown) => restTestState.threadSetParticipant(input) as never,
    resolveTools: (input: unknown) => restTestState.threadResolveTools(input) as never,
    admit: (input: unknown) => restTestState.threadAdmission(input) as never,
    interrupt: (input: unknown) => restTestState.threadInterrupt(input) as never,
  } as unknown as typeof ChatThreads.Service),
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
const restThreadScope = {
  organizationId: restOrgId,
  tenantId: restTenantId,
  tenantUserId: restUserId,
}
const restThread: ThreadRecord = {
  organizationId: restOrgId,
  tenantId: restTenantId,
  id: restOtherId,
  agentId: restOtherId,
  title: "Stored conversation",
  currentLeafMessageId: null,
  lockVersion: 0,
  role: "manager",
  writerActive: false,
  createdAt: restTenantRow.createdAt,
  updatedAt: restTenantRow.createdAt,
}
const restSavedMessage: MessageRecord = {
  ...restThreadScope,
  id: restUserId,
  threadId: restOtherId,
  parentMessageId: null,
  authorTenantUserId: restUserId,
  role: "user",
  state: "complete",
  turnMessageId: null,
  turnState: "completed",
  metadata: { version: 1 },
  payload: { version: 1, parts: [{ id: "part", type: "text", content: "Saved history" }] },
  sourceAssistantMessageId: null,
  sourceToolPartId: null,
  responseTargetId: null,
  createdAt: restTenantRow.createdAt,
  updatedAt: restTenantRow.createdAt,
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
  restTestState.threadScope.mockReturnValue(Effect.succeed(restThreadScope))
  restTestState.thread.mockReturnValue(Effect.succeed(restThread))
  restTestState.threadInterrupt.mockReturnValue(Effect.void)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("v1 router boundary", () => {
  test("upload cancellation exposes claimed ownership separately from retryable conflicts", async () => {
    let failure: UploadClaimed | UploadConflict = new UploadClaimed()
    const handler = HttpRouter.toWebHandler(
      ApiV1Routes.pipe(
        Layer.provideMerge(
          Layer.merge(
            restTestServices,
            Layer.succeed(Uploads, {
              cancel: () => Effect.fail(failure),
            } as unknown as typeof Uploads.Service),
          ),
        ),
        Layer.provide(HttpServer.layerServices),
      ),
      { disableLogger: true },
    )
    try {
      for (const error of [new UploadClaimed(), new UploadConflict()]) {
        failure = error
        await expect(
          sdkCancelChatUpload(restOtherId, {
            astralBeamToken: restTenantJwt,
            apiUrl: "http://localhost/api",
            fetchClient: (input, init) => handler.handler(new Request(input, init)),
          }),
        ).rejects.toMatchObject({
          status: 409,
          body: {
            type: error instanceof UploadClaimed ? "urn:file-upload:claimed" : "about:blank",
            detail: error.message,
          },
        })
      }
    } finally {
      await handler.dispose()
    }
  })

  test("preserves safe 503 with CORS/no-store before setup", async () => {
    restTestState.setupState.mockReturnValue(Effect.succeed({ setupComplete: false }))
    const response = await restRequest("/chat")
    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("10")
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toMatchObject({
      status: 503,
      detail: "Server configuration required.",
    })
  })
  test("disposing the app runtime releases the services the entrypoint's handler holds", async () => {
    const released = vi.fn<() => void>()
    restTestState.appLayer = Layer.merge(
      restTestServices,
      Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(released))),
    )
    restTestState.appRuntime = ManagedRuntime.make(restTestState.appLayer)
    const response = await handleApiV1Request(new Request("http://localhost/api/v1/unknown"))
    expect(response.status).toBe(404)
    await restTestState.appRuntime.dispose()
    expect(released).toHaveBeenCalledOnce()
  })
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

  test("conversation search binds pagination to the search and participant identity", async () => {
    restTestState.threadList.mockReturnValue(
      Effect.succeed({
        items: [restThread],
        nextPosition: { id: restOtherId, updatedAt: restThread.updatedAt.toISOString() },
        previousPosition: null,
      }),
    )
    const headers = { Authorization: `Bearer ${restTenantJwt}` }
    const path = "/chat/threads?q=launch&page_size=1"
    const response = await restRequest(path, { headers })
    expect(response.status).toBe(200)
    expect(restTestState.threadList).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: restThreadScope,
        search: "launch",
        pageSize: 1,
      }),
    )
    const page = (await response.json()) as { page_after: string }
    const cursor = `&page_after=${encodeURIComponent(page.page_after)}`
    expect((await restRequest(path + cursor, { headers })).status).toBe(200)
    expect((await restRequest(path.replace("launch", "other") + cursor, { headers })).status).toBe(
      400,
    )
    restTestState.threadScope.mockReturnValue(
      Effect.succeed({ ...restThreadScope, tenantUserId: restOtherId }),
    )
    expect((await restRequest(path + cursor, { headers })).status).toBe(400)
  })

  test("chat logs safe stream diagnostics and hides thrown middleware errors", async () => {
    restTestState.threadAdmission.mockReturnValue(
      Effect.succeed({
        thread: restThread,
        inputMessage: restSavedMessage,
        assistantMessage: null,
        claim: {
          scope: restThreadScope,
          threadId: restOtherId,
          assistantMessageId: restOtherId,
          inputMessageId: restUserId,
          invocationId: crypto.randomUUID(),
        },
      } satisfies ChatAdmission),
    )
    const failure = new AggregateError(
      [new Error("private server details sk-private-credential")],
      "2 middleware onFinish hooks failed: chat-persistence, managed-thread",
    )
    restTestState.run.mockReturnValue(Effect.succeed(Stream.die(failure)))
    const response = await sdkRunChat(
      {
        threadId: restOtherId,
        runId: "run",
        messages: [{ id: "new", role: "user", content: "private chat transcript" }],
        tools: [],
        context: [],
        forwardedProps: { clientId: restUserId },
      },
      { astralBeamToken: restTenantJwt, apiUrl: "http://localhost/api", fetchClient: restSdkFetch },
    )
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain("RUN_ERROR")
    expect(body).toContain(CHAT_MODEL_UNAVAILABLE_MESSAGE)
    expect(body).not.toMatch(
      /onFinish|chat-persistence|managed-thread|private server details|sk-private-credential/,
    )
    expect(restTestState.logs).toHaveLength(1)
    expect(JSON.parse(restTestState.logs[0]!)).toMatchObject({
      message: "Request failed",
      annotations: {
        operation: "chatRunResponse",
        reasons: [{ kind: "defect", type: "AggregateError" }],
      },
    })
    expect(restTestState.logs[0]).not.toMatch(
      /onFinish|chat-persistence|managed-thread|private server details|sk-private-credential|private chat transcript/,
    )
  })

  test("chat streams for non-admin JWTs and cancellation reaches the producer", async () => {
    restTestState.chat.mockResolvedValue({
      ...restPrincipal,
      tenantUser: { ...restPrincipal.tenantUser, admin: false },
    })
    let stopped = false
    restTestState.threadAdmission.mockReturnValue(
      Effect.succeed({
        thread: restThread,
        inputMessage: restSavedMessage,
        assistantMessage: null,
        claim: {
          scope: restThreadScope,
          threadId: restOtherId,
          assistantMessageId: restOtherId,
          inputMessageId: restUserId,
          invocationId: crypto.randomUUID(),
        },
      } satisfies ChatAdmission),
    )
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
        threadId: restOtherId,
        runId: "run",
        messages: [{ id: "new", role: "user", content: "Hello" }],
        tools: [],
        context: [],
        forwardedProps: { clientId: restUserId },
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
    expect(restTestState.logs).toEqual([])
    expect(restTestState.consume.mock.calls[0]![0]).toHaveProperty(
      "limit",
      CHAT_RATE_LIMIT_MAX_REQUESTS,
    )
    expect(restTestState.consume.mock.calls[0]![0]).toHaveProperty(
      "key",
      expect.stringMatching(/^chat:/),
    )
    expect(restTestState.verify).not.toHaveBeenCalled()
    expect(restTestState.predicates).toEqual([])
  })

  test("thread resources consume a scoped limit before reading history or changing data", async () => {
    restTestState.threadCreate.mockReturnValue(Effect.succeed(restThread))
    const request = {
      method: "POST",
      headers: { Authorization: `Bearer ${restTenantJwt}`, "Content-Type": "application/json" },
      body: "{}",
    }
    expect((await restRequest("/chat/threads", request)).status).toBe(201)
    expect(restTestState.consume.mock.calls[0]![0].key).toMatch(/^chat-resource:/)
    restTestState.consume.mockReturnValue(
      Effect.fail(
        new RateLimiter.RateLimiterError({
          reason: new RateLimiter.RateLimitExceeded({
            key: "test-limit",
            limit: 100,
            remaining: 0,
            retryAfter: Duration.seconds(5),
          }),
        }),
      ),
    )
    const rejected = await restRequest("/chat/threads", request)
    expect(rejected.status).toBe(429)
    expect(rejected.headers.get("retry-after")).toBe("5")
    expect(restTestState.threadCreate).toHaveBeenCalledTimes(1)
    for (const path of [
      `/chat/threads/${restOtherId}/messages`,
      `/chat/threads/${restOtherId}/messages/${restUserId}/attachments/upload`,
    ]) {
      const response = await restRequest(path, {
        headers: { Authorization: `Bearer ${restTenantJwt}` },
      })
      expect(response.status).toBe(429)
      expect(response.headers.get("retry-after")).toBe("5")
    }
    expect(restTestState.threadSnapshot).not.toHaveBeenCalled()
    expect(restTestState.threadMessage).not.toHaveBeenCalled()
    expect(restTestState.consume.mock.calls.at(-1)![0].key).toBe(
      restTestState.consume.mock.calls[0]![0].key,
    )
  })

  test("saved history exposes scoped messages without internal writer or idempotency data", async () => {
    const attachment = {
      id: "upload",
      type: "image",
      source: {
        type: "data",
        value: `data:image/png;base64,${btoa("saved image")}`,
        mimeType: "image/png",
      },
      metadata: { filename: "upload.png", size: 11 },
    }
    const savedMessage = {
      ...restSavedMessage,
      payload: {
        ...restSavedMessage.payload,
        parts: [...restSavedMessage.payload.parts, attachment],
      },
    }
    restTestState.threadSnapshot.mockReturnValue(
      Effect.succeed({
        thread: restThread,
        messages: { items: [savedMessage], nextPosition: null, previousPosition: null },
        pending: [],
      }),
    )
    const headers = { Authorization: `Bearer ${restTenantJwt}` }
    const response = await restRequest(`/chat/threads/${restOtherId}/messages`, { headers })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      thread: {
        id: restOtherId,
        title: restThread.title,
        agent_id: `agent_${restOrgId}_${restOtherId}`,
        version: 0,
        current_leaf_message_id: null,
        role: "manager",
        writer_active: false,
        created_at: restTenantRow.createdAt.toISOString(),
        updated_at: restTenantRow.updatedAt.toISOString(),
      },
      messages: [
        {
          id: restUserId,
          role: "user",
          state: "complete",
          parent_message_id: null,
          parts: [
            ...restSavedMessage.payload.parts,
            { ...attachment, source: { type: "attachment", mimeType: "image/png" } },
          ],
          author_tenant_user_id: restUserId,
          source_assistant_message_id: null,
          source_tool_part_id: null,
          response_target_id: null,
          created_at: restTenantRow.createdAt.toISOString(),
        },
      ],
      pending_interactions: [],
      page_after: null,
      page_before: null,
    })
    expect(restTestState.threadSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ scope: restThreadScope, id: restOtherId }),
    )
    restTestState.threadMessage.mockReturnValue(Effect.succeed(savedMessage))
    const download = await restRequest(
      `/chat/threads/${restOtherId}/messages/${restUserId}/attachments/upload`,
      { headers },
    )
    expect(download.status).toBe(200)
    expect(download.headers.get("content-type")).toBe("image/png")
    expect(await download.text()).toBe("saved image")
    expect(restTestState.threadMessage).toHaveBeenCalledWith({
      scope: restThreadScope,
      id: restOtherId,
      messageId: restUserId,
    })
    restTestState.threadMessage.mockReturnValue(Effect.fail(new ChatThreadNotFound()))
    const deniedDownload = await restRequest(
      `/chat/threads/${restOtherId}/messages/${restUserId}/attachments/upload`,
      { headers },
    )
    expect(deniedDownload.status).toBe(404)
    restTestState.thread.mockReturnValue(Effect.fail(new ChatThreadNotFound()))
    const inaccessible = await restRequest(`/chat/threads/${restOtherId}`, { headers })
    expect(inaccessible.status).toBe(404)
    expect(await inaccessible.text()).not.toContain(restThread.title)
  })

  test("conversation managers search only their Tenant without directory admin access", async () => {
    restTestState.chat.mockResolvedValue({
      ...restPrincipal,
      tenantUser: { ...restPrincipal.tenantUser, admin: false },
    })
    const headers = { Authorization: `Bearer ${restTenantJwt}` }
    const path = `/chat/threads/${restOtherId}/tenant-users?q=Alice&page_size=1`
    restTestState.rows.push([
      {
        ...restUserRow,
        name: "Alice",
        externalId: "alice",
        metadata: { email: "alice@example.com", private_note: "hidden" },
      },
      { ...restUserRow, id: restOtherId, name: "Alice Two", externalId: "alice-two" },
    ])
    const response = await restRequest(path, { headers })
    expect(response.status).toBe(200)
    const page = (await response.json()) as { items: unknown[]; page_after: string }
    expect(page.items).toEqual([
      { id: restUserId, name: "Alice", external_id: "alice", email: "alice@example.com" },
    ])
    expect(restLastPredicate().params).toEqual([
      restOrgId,
      restTenantId,
      restTenantId,
      "%Alice%",
      "%Alice%",
    ])
    restTestState.rows.push([])
    expect(
      (await restRequest(`${path}&page_after=${encodeURIComponent(page.page_after)}`, { headers }))
        .status,
    ).toBe(200)
    expect(
      (
        await restRequest(
          `${path.replace("Alice", "Bob")}&page_after=${encodeURIComponent(page.page_after)}`,
          { headers },
        )
      ).status,
    ).toBe(400)
    for (const role of ["member", "viewer"] as const) {
      restTestState.thread.mockReturnValue(Effect.succeed({ ...restThread, role }))
      expect((await restRequest(path, { headers })).status).toBe(403)
    }
    restTestState.thread.mockReturnValue(Effect.fail(new ChatThreadNotFound()))
    expect((await restRequest(path, { headers })).status).toBe(404)
  })

  test("participant listing and sharing project full database rows into the public contract", async () => {
    const participant: ParticipantRecord = {
      ...restThreadScope,
      id: restOtherId,
      threadId: restOtherId,
      role: "manager",
      name: "Example participant",
      externalId: "external-participant",
      email: null,
      createdAt: restTenantRow.createdAt,
      updatedAt: restTenantRow.updatedAt,
    }
    restTestState.threadParticipants.mockReturnValue(
      Effect.succeed({
        items: [participant],
        nextPosition: { id: participant.id },
        previousPosition: null,
      }),
    )
    restTestState.threadSetParticipant.mockReturnValue(
      Effect.succeed({
        ...participant,
        role: "member",
      }),
    )
    const headers = { Authorization: `Bearer ${restTenantJwt}` }
    const listed = await restRequest(`/chat/threads/${restOtherId}/participants`, { headers })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({
      items: [
        {
          tenant_user_id: restUserId,
          role: "manager",
          name: "Example participant",
          external_id: "external-participant",
          email: null,
        },
      ],
      page_after: expect.any(String) as unknown,
      page_before: null,
    })
    expect(listed.headers.get("link")).toContain('rel="next"')
    expect(restTestState.threadParticipants).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: restThreadScope,
        id: restOtherId,
      }),
    )
    const shared = await restRequest(`/chat/threads/${restOtherId}/participants/${restUserId}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member", expected_version: 0 }),
    })
    expect(shared.status).toBe(200)
    expect(await shared.json()).toEqual({
      tenant_user_id: restUserId,
      role: "member",
      name: "Example participant",
      external_id: "external-participant",
      email: null,
    })
    expect(restTestState.threadSetParticipant).toHaveBeenCalledExactlyOnceWith({
      scope: restThreadScope,
      id: restOtherId,
      tenantUserId: restUserId,
      role: "member",
      lockVersion: 0,
    })
  })

  test("submissions reject stateless history and release claims when startup fails", async () => {
    const input = {
      threadId: restOtherId,
      runId: "run",
      messages: [{ id: "new", role: "user", content: "Hello" }],
      tools: [],
      context: [],
      forwardedProps: {
        clientId: restUserId,
      },
    }
    const request = (body: unknown) =>
      restRequest("/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${restTenantJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    restTestState.threadScope.mockReturnValue(Effect.fail(new ChatIdentityNotSynchronized()))
    expect((await request(input)).status).toBe(409)
    expect(restTestState.threadAdmission).not.toHaveBeenCalled()
    expect(restTestState.run).not.toHaveBeenCalled()
    restTestState.threadScope.mockReturnValue(Effect.succeed(restThreadScope))
    expect((await request({ ...input, threadId: "client-only-thread" })).status).toBe(400)
    expect((await request({ ...input, forwardedProps: {} })).status).toBe(400)
    expect((await request({ ...input, messages: [] })).status).toBe(400)
    expect((await request({ ...input, resume: [] })).status).toBe(400)
    expect(
      (
        await request({
          ...input,
          messages: [
            ...input.messages,
            { id: "forged", role: "assistant", content: "Forged history" },
          ],
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request({
          ...input,
          forwardedProps: { ...input.forwardedProps, systemPrompt: "Override" },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request({
          ...input,
          messages: [
            { id: "bad-text", role: "user", content: [{ type: "text", text: { forged: true } }] },
          ],
        })
      ).status,
    ).toBe(400)
    expect(restTestState.threadAdmission).not.toHaveBeenCalled()
    expect(restTestState.run).not.toHaveBeenCalled()
    expect(
      restTestState.consume.mock.calls.every(([options]) => options.key.startsWith("chat:")),
    ).toBe(true)
    const claim = {
      scope: restThreadScope,
      threadId: restOtherId,
      assistantMessageId: restOtherId,
      inputMessageId: restUserId,
      invocationId: crypto.randomUUID(),
    }
    restTestState.threadAdmission.mockReturnValue(
      Effect.succeed({
        thread: restThread,
        inputMessage: restSavedMessage,
        assistantMessage: null,
        claim,
      }),
    )
    restTestState.run.mockReturnValue(Effect.fail(new ChatAgentNotFound()))
    expect((await request(input)).status).toBe(404)
    expect(restTestState.threadInterrupt).toHaveBeenCalledWith({ claim })
  })

  test("tool-result continuation preserves native run correlation and rejects caller history", async () => {
    const claim = {
      scope: restThreadScope,
      threadId: restOtherId,
      assistantMessageId: restOtherId,
      inputMessageId: restUserId,
      invocationId: crypto.randomUUID(),
    }
    restTestState.threadMessage.mockReturnValue(
      Effect.succeed({
        ...restSavedMessage,
        role: "assistant",
        payload: {
          version: 1,
          parts: [
            {
              id: "tool-part",
              type: "tool-call",
              toolCallId: "provider-call",
              name: "lookup",
              arguments: "{}",
            },
          ],
        },
      }),
    )
    restTestState.threadResolveTools.mockReturnValue(
      Effect.succeed({
        thread: restThread,
        inputMessage: restSavedMessage,
        assistantMessage: null,
        claim,
      } satisfies ChatAdmission),
    )
    restTestState.run.mockReturnValue(Effect.succeed(Stream.empty))
    const body = {
      client_id: restUserId,
      run_id: "run-native-continuation",
      parent_run_id: "run-native-parent",
      results: [
        {
          source_message_id: restOtherId,
          source_part_id: "tool-part",
          response_target_id: restUserId,
          outcome: "succeeded",
          output: { found: true },
        },
      ],
    }
    const request = (payload: unknown) =>
      restRequest(`/chat/threads/${restOtherId}/tool-results`, {
        method: "POST",
        headers: { Authorization: `Bearer ${restTenantJwt}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    const response = await request(body)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    await response.text()
    expect(restTestState.run.mock.calls[0]?.[0]).toMatchObject({
      params: { runId: body.run_id, parentRunId: body.parent_run_id, messages: [] },
      managed: { claim },
    })
    expect((await request({ ...body, resume: [] })).status).toBe(400)
    expect((await request({ ...body, messages: [] })).status).toBe(400)
    expect(restTestState.run).toHaveBeenCalledTimes(1)
    expect(restTestState.threadResolveTools).toHaveBeenCalledTimes(1)
  })

  test("chat HTTP failures share v1 errors, CORS, challenges, and retry information", async () => {
    const headers = {
      Authorization: `Bearer ${restTenantJwt}`,
      "Content-Type": "application/json",
    }
    for (const [body, extra, status] of [
      ["{", {}, 400],
      ["{}", { "content-length": String(33 * 1024 * 1024) }, 413],
      ["{}", { "content-type": "text/plain" }, 415],
    ] as const) {
      for (const path of ["/chat", `/chat/threads/${restOtherId}/tool-results`]) {
        const response = await restRequest(path, {
          method: "POST",
          headers: { ...headers, ...extra },
          body,
        })
        expect(response.status).toBe(status)
        expect(response.headers.get("content-type")).toContain("application/problem+json")
        expect(response.headers.get("access-control-allow-origin")).toBe("*")
        expect(await response.json()).toMatchObject({ status })
      }
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
    for (const path of ["/chat", `/chat/threads/${restOtherId}/tool-results`]) {
      for (const [body, extra] of [
        ["{", {}],
        ["{}", {}],
        ["{}", { "content-length": String(33 * 1024 * 1024) }],
      ] as const) {
        const limited = await restRequest(path, {
          method: "POST",
          headers: { ...headers, ...extra },
          body,
        })
        expect(limited.status).toBe(429)
        expect(limited.headers.get("retry-after")).toBe("2")
        const [limit] = restTestState.consume.mock.calls.at(-1)!
        expect(limit.key).toMatch(path === "/chat" ? /^chat:/ : /^chat-continuation:/)
        expect(limit).toHaveProperty(
          "limit",
          path === "/chat"
            ? CHAT_RATE_LIMIT_MAX_REQUESTS
            : CHAT_CONTINUATION_RATE_LIMIT_MAX_REQUESTS,
        )
      }
    }
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

describe("administrative conversation reads", () => {
  const directoryThread = {
    ...restThread,
    tenantName: "Customer",
    tenantExternalId: "customer",
    participants: [{ name: "Customer user", externalId: "customer-user" }],
  }
  const paths = `/tenants/${restTenantId}/threads/${restOtherId}`
  const organizationJwt = `${btoa(JSON.stringify({ typ: "astralbeam-organization+jwt" }))}.e30.c2ln`
  const tenantJwt = `${btoa(JSON.stringify({ typ: "astralbeam+jwt" }))}.e30.c2ln`
  const emptyPage = { items: [], nextPosition: null, previousPosition: null }
  beforeEach(() => {
    restTestState.directoryList.mockReturnValue(
      Effect.succeed({ ...emptyPage, items: [directoryThread] }),
    )
    restTestState.directorySnapshot.mockReturnValue(
      Effect.succeed({
        thread: directoryThread,
        messages: { ...emptyPage, items: [restSavedMessage] },
      }),
    )
    restTestState.directoryMessage.mockReturnValue(
      Effect.succeed({
        ...restSavedMessage,
        payload: {
          version: 1,
          parts: [
            {
              id: "upload",
              type: "document",
              source: { type: "data", value: "SGVsbG8=", mimeType: "text/plain" },
              metadata: { filename: "note.txt" },
            },
          ],
        },
      }),
    )
  })
  test.each(["api-key", "owner", "developer", "viewer", "tenant-admin"])(
    "%s can read listings, history and uploads without participant grants",
    async (role) => {
      const headers =
        role === "api-key"
          ? { "X-API-Key": restTestApiKey }
          : { Authorization: `Bearer ${role === "tenant-admin" ? tenantJwt : organizationJwt}` }
      restTestState.organizationAuth.mockReturnValue(
        Effect.succeed({
          organizationId: restOrgId,
          currentUser: { id: restUserId, name: "Operator", email: "operator@example.com", role },
        }),
      )
      restTestState.chat.mockResolvedValue({
        ...restPrincipal,
        tenantUser: { ...restPrincipal.tenantUser, admin: true },
      })
      if (role === "tenant-admin")
        restTestState.rows.push(...Array.from({ length: 3 }, () => [{ id: restTenantId }]))
      const list = await restRequest("/threads", { headers })
      expect(list.status).toBe(200)
      const body = (await list.json()) as { items: Record<string, unknown>[] }
      expect(body.items[0]!.participants).toEqual([
        { name: "Customer user", external_id: "customer-user" },
      ])
      expect(body.items[0]).toMatchObject({
        tenant_id: restTenantId,
        tenant_external_id: "customer",
        agent_id: `agent_${restOrgId}_${restOtherId}`,
      })
      expect(body.items[0]).not.toHaveProperty("role")
      expect(body.items[0]).not.toHaveProperty("writer_active")
      const history = await restRequest(`${paths}/messages`, { headers })
      expect(await history.json()).toMatchObject({
        messages: [{ parts: [{ content: "Saved history" }] }],
      })
      const upload = await restRequest(`${paths}/messages/${restUserId}/attachments/upload`, {
        headers,
      })
      expect(upload.status).toBe(200)
      expect(await upload.text()).toBe("Hello")
      expect(upload.headers.get("cache-control")).toContain("no-store")
      expect(restTestState.threadScope).not.toHaveBeenCalled()
      expect(restTestState.threadCreate).not.toHaveBeenCalled()
      expect(restTestState.run).not.toHaveBeenCalled()
      expect(
        (restTestState.directorySnapshot.mock.calls[0]![0] as { scope: { tenantId?: string } })
          .scope.tenantId,
      ).toBe(role === "tenant-admin" ? restTenantId : undefined)
    },
  )
  test("non-admin and revoked organization members fail before directory reads", async () => {
    restTestState.chat.mockResolvedValue({
      ...restPrincipal,
      tenantUser: { ...restPrincipal.tenantUser, admin: false },
    })
    expect(
      (await restRequest("/threads", { headers: { Authorization: `Bearer ${tenantJwt}` } })).status,
    ).toBe(403)
    restTestState.organizationAuth.mockReturnValue(Effect.fail(new OrganizationMembershipError()))
    expect(
      (
        await restRequest(`${paths}/messages`, {
          headers: { Authorization: `Bearer ${organizationJwt}` },
        })
      ).status,
    ).toBe(403)
    expect(restTestState.directoryList).not.toHaveBeenCalled()
    expect(restTestState.directorySnapshot).not.toHaveBeenCalled()
  })
  test("activity cursors bind collection, title search and Tenant filter", async () => {
    restTestState.directoryList.mockReturnValue(
      Effect.succeed({
        items: [directoryThread],
        nextPosition: {
          id: restOtherId,
          tenantId: restTenantId,
          updatedAt: "2026-09-01 00:00:00.123456+00",
        },
        previousPosition: null,
      }),
    )
    const response = await restRequest(
      `/threads?q=Budget&filter[tenant_id]=${restTenantId}&page_size=1`,
    )
    const { page_after } = (await response.json()) as { page_after: string }
    expect(
      (
        await restRequest(
          `/threads?q=Budget&filter[tenant_id]=${restTenantId}&page_after=${page_after}`,
        )
      ).status,
    ).toBe(200)
    expect(restTestState.directoryList).toHaveBeenLastCalledWith(
      expect.objectContaining({
        position: {
          id: restOtherId,
          tenantId: restTenantId,
          updatedAt: "2026-09-01 00:00:00.123456+00",
        },
      }),
    )
    for (const path of [
      `/threads?q=Other&filter[tenant_id]=${restTenantId}`,
      `/threads?q=Budget`,
      `${paths}/messages`,
    ]) {
      expect(
        (await restRequest(`${path}${path.includes("?") ? "&" : "?"}page_after=${page_after}`))
          .status,
      ).toBe(400)
    }
  })
  test("signed Tenant scope cannot be replaced by a filter or resource path", async () => {
    restTestState.chat.mockResolvedValue({
      ...restPrincipal,
      tenantUser: { ...restPrincipal.tenantUser, admin: true },
    })
    restTestState.rows.push([{ id: restTenantId }], [{ id: restTenantId }])
    const headers = { Authorization: `Bearer ${tenantJwt}` }
    expect(
      (await restRequest(`/threads?filter[tenant_id]=${restOtherId}`, { headers })).status,
    ).toBe(200)
    expect(
      (
        restTestState.directoryList.mock.calls[0]![0] as {
          scope: { organizationId: string; tenantId: string | null }
        }
      ).scope,
    ).toMatchObject({ organizationId: restOrgId, tenantId: null })
    restTestState.directorySnapshot.mockReturnValue(Effect.fail(new ChatThreadNotFound()))
    expect(
      (await restRequest(`/tenants/${restOtherId}/threads/${restOtherId}/messages`, { headers }))
        .status,
    ).toBe(404)
    const input = restTestState.directorySnapshot.mock.calls[0]![0] as {
      tenantId: string
      scope: { tenantId: string }
    }
    expect(input.tenantId).toBe(restOtherId)
    expect(input.scope.tenantId).toBe(restTenantId)
  })
})
