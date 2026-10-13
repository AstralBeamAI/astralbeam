import { and, eq, sql } from "drizzle-orm"
import { spawn } from "node:child_process"
import { Effect, Layer, ManagedRuntime, Redacted, Result } from "effect"
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest"
const mcpIntegration = vi.hoisted(() => {
  const value = globalThis.process.env.DATABASE_URL
  const url = value === "postgres://test:test@127.0.0.1:5432/test" ? undefined : value
  if (url && (new URL(url).hostname !== "127.0.0.1" || !new URL(url).pathname.endsWith("_test")))
    throw new Error("Use a disposable loopback database ending in _test")
  const child = globalThis.process.env.MCP_REFRESH_PROCESS
  const worker = child
    ? (JSON.parse(child) as {
        actor: import("./schemas.ts").McpActor
        reference: import("./schemas.ts").McpReference
        origin: string
      })
    : undefined
  return {
    url,
    worker,
    baseUrl: "https://astralbeam.example",
    fetch: worker
      ? (input: string | URL | Request, init?: RequestInit) => {
          const target = new URL(input instanceof Request ? input.url : input)
          return globalThis.fetch(new URL(target.pathname + target.search, worker.origin), init)
        }
      : globalThis.fetch,
  }
})
vi.mock("./network.server.ts", async (original) => ({
  ...(await original<typeof import("./network.server.ts")>()),
  mcpGuardedFetch: (_dispatcher: unknown, input: string | URL | Request, init?: RequestInit) =>
    mcpIntegration.fetch(input, init),
}))
import { Database, getAuthDatabase } from "@/db/database"
import { organization, cacheEntry, tenant, tenantUser } from "@/db/schema"
import { mcpConnection } from "@/db/schema/mcp"
import { Config } from "@/lib/config/config"
import { McpConnections } from "./mcp.server.ts"
import { McpAuthorization } from "./authorization/authorization.ts"
import { decryptDatabaseValue } from "@/db/lib/encryption"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import { McpAttemptEnvelopeSchema } from "./schemas.ts"
import { startMcpFixture } from "./testing/fixture.ts"
import type { McpActor, McpReference } from "./schemas.ts"

const mcpPersistenceLayer = Layer.mergeAll(
  McpConnections.layer,
  McpAuthorization.layerNoDeps.pipe(
    Layer.provide([
      Database.layer,
      McpConnections.layer,
      Layer.succeed(Config, {
        get: () => Effect.succeed(mcpIntegration.baseUrl),
      } as unknown as typeof Config.Service),
    ]),
  ),
)
test.skipIf(!mcpIntegration.url || !mcpIntegration.worker)(
  "MCP refresh process worker",
  async () => {
    const current = ManagedRuntime.make(mcpPersistenceLayer)
    try {
      globalThis.process.stdout.write("MCP refresh worker ready\n")
      const credential = await current.runPromise(
        Effect.flatMap(McpAuthorization, (service) =>
          service.getCredential(mcpIntegration.worker!),
        ),
      )
      expect(Redacted.value(credential)).toMatchObject({
        tokens: { access_token: "access-1", refresh_token: "rotating-refresh" },
      })
    } finally {
      await current.dispose()
    }
  },
  60_000,
)
describe.skipIf(!mcpIntegration.url || !!mcpIntegration.worker)(
  "private MCP credentials and OAuth",
  () => {
    const runtime = ManagedRuntime.make(mcpPersistenceLayer)
    let db: ReturnType<typeof getAuthDatabase>
    let fixture: Awaited<ReturnType<typeof startMcpFixture>>
    let actor: McpActor
    const connections = <A, E>(
      use: (service: typeof McpConnections.Service) => Effect.Effect<A, E>,
    ) => runtime.runPromise(Effect.flatMap(McpConnections, use))
    const authority = <A, E>(
      use: (service: typeof McpAuthorization.Service) => Effect.Effect<A, E>,
    ) => runtime.runPromise(Effect.flatMap(McpAuthorization, use))
    beforeEach(async () => {
      db = getAuthDatabase()
      await db.execute(sql`truncate organization cascade`)
      await db.delete(cacheEntry).where(eq(cacheEntry.namespace, "mcp-oauth"))
      mcpIntegration.baseUrl = "https://astralbeam.example"
      const [org] = await db.insert(organization).values({ name: "MCP", slug: "mcp" }).returning()
      const [customer] = await db
        .insert(tenant)
        .values({ organizationId: org!.id, externalId: "tenant" })
        .returning()
      const [person] = await db
        .insert(tenantUser)
        .values({ organizationId: org!.id, tenantId: customer!.id, externalId: "user" })
        .returning()
      actor = { organizationId: org!.id, tenantId: customer!.id, tenantUserId: person!.id }
      fixture = await startMcpFixture()
      mcpIntegration.fetch = fixture.fetch
    })
    afterEach(async () => {
      await fixture.close()
    })
    afterAll(async () => {
      await runtime.dispose()
    })
    async function createOAuth(cimd = false, manual = false) {
      fixture.state.oauth = true
      fixture.state.cimd = cimd
      const server = await connections((service) =>
        service.createServer(actor.organizationId, {
          endpointUrl: "https://fixture.example/mcp",
          authConfig: {
            kind: "oauth",
            profile: manual ? "google" : "standard",
            requestedScopes: ["read"],
            ...(manual
              ? {
                  client: {
                    clientId: "manual-client",
                    clientSecret: "manual-secret",
                    tokenEndpointAuthMethod: "client_secret_post" as const,
                  },
                }
              : {}),
          },
        }),
      )
      const reference = await connections((service) => service.createConnection(actor, server.id))
      return { server, reference }
    }
    async function authorize(reference: McpReference) {
      const started = await authority((service) =>
        service.start({ actor, reference, origin: mcpIntegration.baseUrl }),
      )
      const [entry] = await db
        .select()
        .from(cacheEntry)
        .where(
          and(
            eq(cacheEntry.namespace, "mcp-oauth"),
            eq(cacheEntry.key, `${actor.organizationId}:${actor.tenantId}:${reference.id}`),
          ),
        )
      const payload = Result.getOrThrow(
        decryptDatabaseValue({
          storedValue: JSON.parse(entry!.value),
          schema: McpAttemptEnvelopeSchema,
          keyring: getDatabaseEncryptionKeyring(),
        }),
      ).value
      expect(entry!.value).not.toContain(payload.verifier)
      const challenge = "b".repeat(43)
      expect(
        await authority((service) =>
          service.browserRedirect({
            reference: started.attempt,
            browserBinding: challenge,
            origin: mcpIntegration.baseUrl,
          }),
        ),
      ).toBeNull()
      await authority((service) =>
        service.bindBrowser({
          actor,
          reference: started.attempt,
          challenge,
        }),
      )
      return {
        started,
        payload,
        challenge,
        params: new URLSearchParams({
          state: payload.state,
          code: "authorization-code",
          iss: "https://fixture.example",
        }),
      }
    }
    function callback(
      flow: Awaited<ReturnType<typeof authorize>>,
      overrides: Partial<{ params: URLSearchParams; browserBinding: string; origin: string }> = {},
    ) {
      return authority((service) =>
        service.callback({
          params: flow.params,
          browserBinding: flow.challenge,
          origin: mcpIntegration.baseUrl,
          ...overrides,
        }),
      )
    }
    async function connectedOAuth(manual = false) {
      const created = await createOAuth(false, manual)
      const flow = await authorize(created.reference)
      await callback(flow)
      await authority((service) => service.complete({ actor, reference: flow.started.attempt }))
      return created
    }
    async function expire(reference: McpReference) {
      const [row] = await db.select().from(mcpConnection).where(eq(mcpConnection.id, reference.id))
      const envelope = row!.credentials!
      if (envelope.credential.kind !== "oauth") throw new Error("OAuth fixture required")
      await db
        .update(mcpConnection)
        .set({ credentials: { ...envelope, credential: { ...envelope.credential, expiresAt: 0 } } })
        .where(eq(mcpConnection.id, reference.id))
    }
    test.each([
      [false, false],
      [true, false],
      [false, true],
    ])("DCR, CIMD and manual Google authorization, cimd=%s manual=%s", async (cimd, manual) => {
      const { reference } = await createOAuth(cimd, manual)
      const flow = await authorize(reference)
      const url = new URL(flow.payload.authorizationUrl!)
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("resource")).toBe("https://fixture.example/mcp")
      expect(url.searchParams.get("access_type")).toBe(manual ? "offline" : null)
      expect(url.searchParams.get("scope")).toBe("read")
      expect(flow.payload.discovery!.resourceMetadataUrl).toBe(
        "https://fixture.example/metadata/resource",
      )
      expect(fixture.state.registrations).toBe(!cimd && !manual ? 1 : 0)
      await callback(flow)
      await authority((service) => service.complete({ actor, reference: flow.started.attempt }))
      expect(
        Redacted.value(await authority((service) => service.getCredential({ actor, reference }))),
      ).toMatchObject({ tokens: { access_token: "access-0", refresh_token: "rotating-refresh" } })
      const {
        rows: [stored],
      } = await db.execute<{ auth_config: unknown }>(
        sql`select auth_config from mcp_server where id = ${reference.mcpServerId}`,
      )
      expect(stored!.auth_config).toMatchObject({ kind: "oauth" })
      expect(JSON.stringify(stored!.auth_config)).not.toContain("manual-secret")
      expect(JSON.stringify(await connections((service) => service.catalog(actor)))).not.toMatch(
        /manual-secret|access-0|rotating-refresh/,
      )
    })
    test("unreadable OAuth application credentials do not prevent local disconnect", async () => {
      const { reference } = await connectedOAuth(true)
      await db.execute(
        sql`update mcp_server set auth_config = jsonb_set(auth_config, '{client}', '"unreadable"') where id = ${reference.mcpServerId}`,
      )
      await expect(
        authority((service) => service.getCredential({ actor, reference })),
      ).rejects.toThrow()
      await authority((service) => service.disconnect({ actor, reference }))
      expect(await db.select().from(mcpConnection)).toEqual([])
    })

    test("rejects browser mismatch, issuer substitution, replay and a superseded attempt", async () => {
      const { reference } = await createOAuth()
      const old = await authorize(reference)
      const flow = await authorize(reference)
      await expect(callback(old)).rejects.toThrow()
      await expect(callback(flow, { browserBinding: "other-browser" })).rejects.toThrow()
      const substituted = new URLSearchParams(flow.params)
      substituted.set("iss", "https://attacker.example")
      await expect(callback(flow, { params: substituted })).rejects.toThrow()
      expect(fixture.state.tokenRequests).toBe(0)
      await callback(flow)
      await expect(callback(flow)).rejects.toThrow()
      await expect(
        authority((service) =>
          service.complete({
            actor: { ...actor, tenantUserId: "019a0000-0000-7000-8000-000000000099" },
            reference: flow.started.attempt,
          }),
        ),
      ).rejects.toThrow()
      await authority((service) => service.complete({ actor, reference: flow.started.attempt }))
      await expect(
        authority((service) => service.complete({ actor, reference: flow.started.attempt })),
      ).rejects.toThrow()
      expect(fixture.state.tokenRequests).toBe(1)
    })
    test("untrusted openers cannot relay browser challenges into another user's grant", async () => {
      const { reference } = await createOAuth()
      const origin = "https://attacker.example"
      await expect(
        authority((service) => service.start({ actor, reference, origin })),
      ).rejects.toThrow()
      expect(fixture.state.registrations).toBe(0)
      const flow = await authorize(reference)
      await expect(
        authority((service) =>
          service.browserRedirect({
            reference: flow.started.attempt,
            browserBinding: flow.challenge,
            origin,
          }),
        ),
      ).rejects.toThrow()
      await expect(callback(flow, { origin })).rejects.toThrow()
      expect(fixture.state.tokenRequests).toBe(0)
    })
    test("expired attempts and disconnect cannot commit callback credentials", async () => {
      const { reference } = await createOAuth()
      const flow = await authorize(reference)
      await db
        .update(cacheEntry)
        .set({ expiresAt: new Date(0) })
        .where(eq(cacheEntry.namespace, "mcp-oauth"))
      await expect(callback(flow)).rejects.toThrow()
      const fresh = await authorize(reference)
      await callback(fresh)
      await authority((service) => service.disconnect({ actor, reference }))
      await expect(
        authority((service) => service.complete({ actor, reference: fresh.started.attempt })),
      ).rejects.toThrow()
      expect(await db.select().from(mcpConnection)).toEqual([])
    })
    test("two Deno application processes redeem one refresh token", async () => {
      const { reference } = await connectedOAuth()
      await expire(reference)
      let ready = 0
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      fixture.state.tokenGate = () => gate
      const processes = [0, 1].map(() => {
        const child = spawn(
          globalThis.process.execPath,
          [
            "task",
            "test",
            "--project=integration",
            "--maxWorkers=1",
            "src/lib/mcp/mcp.integration.test.ts",
            "-t",
            "MCP refresh process worker",
          ],
          {
            cwd: globalThis.process.cwd(),
            env: {
              ...globalThis.process.env,
              MCP_REFRESH_PROCESS: JSON.stringify({ actor, reference, origin: fixture.origin }),
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        )
        let output = ""
        let announced = false
        child.stdout.on("data", (data: Buffer) => {
          output += data.toString()
          if (!announced && output.includes("MCP refresh worker ready")) {
            announced = true
            ready++
          }
        })
        child.stderr.on("data", (data: Buffer) => {
          output += data.toString()
        })
        const completed = new Promise<number | null>((resolve, reject) => {
          child.once("error", reject)
          child.once("exit", resolve)
        })
        return { child, completed, diagnostics: () => output }
      })
      try {
        await vi.waitFor(() => expect(ready).toBe(2), { timeout: 30_000 })
        await vi.waitFor(() => expect(fixture.state.refreshes).toBe(1))
        release()
        for (const entry of processes)
          if ((await entry.completed) !== 0) throw new Error(entry.diagnostics())
        expect(fixture.state.refreshes).toBe(1)
        const [row] = await db
          .select()
          .from(mcpConnection)
          .where(eq(mcpConnection.id, reference.id))
        expect(row!.lockVersion).toBe(1)
        expect(row!.credentials!.refreshStartedAt).toBeUndefined()
      } finally {
        release()
        for (const { child } of processes) if (child.exitCode === null) child.kill("SIGTERM")
      }
    }, 60_000)
    test("reconnect wins over an in-flight refresh and never inherits the previous account's refresh token", async () => {
      const { reference } = await connectedOAuth()
      fixture.state.authorizationToken = "new-account"
      fixture.state.authorizationRefreshToken = null
      const flow = await authorize(reference)
      await callback(flow)
      await expire(reference)
      let release!: () => void
      fixture.state.tokenGate = () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
      const pending = authority((service) => service.getCredential({ actor, reference })).then(
        () => false,
        () => true,
      )
      await vi.waitFor(() => expect(fixture.state.refreshes).toBe(1))
      try {
        await authority((service) => service.complete({ actor, reference: flow.started.attempt }))
      } finally {
        release()
      }
      expect(await pending).toBe(true)
      const credential = Redacted.value(
        await authority((service) => service.getCredential({ actor, reference })),
      )
      expect(credential).toMatchObject({ kind: "oauth", tokens: { access_token: "new-account" } })
      if (credential.kind !== "oauth") throw new Error("OAuth fixture required")
      expect(credential.tokens.refresh_token).toBeUndefined()
      await expect(
        authority((service) => service.getCredential({ actor, reference, expectedVersion: 1 })),
      ).rejects.toThrow()
    })
    test("disconnect wins over an in-flight refresh", async () => {
      const { reference } = await connectedOAuth()
      await expire(reference)
      let release!: () => void
      fixture.state.tokenGate = () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
      const pending = authority((service) => service.getCredential({ actor, reference })).then(
        () => false,
        () => true,
      )
      await vi.waitFor(() => expect(fixture.state.refreshes).toBe(1))
      try {
        await authority((service) => service.disconnect({ actor, reference }))
      } finally {
        release()
      }
      expect(await pending).toBe(true)
      expect(await db.select().from(mcpConnection)).toEqual([])
    })
    test.each(["disconnectResponse", "gatewayError"] as const)(
      "expired claims and %s require reconnecting without a second redemption",
      async (failure) => {
        const { reference } = await connectedOAuth()
        await expire(reference)
        const [original] = await db
          .select()
          .from(mcpConnection)
          .where(eq(mcpConnection.id, reference.id))
        await db
          .update(mcpConnection)
          .set({ credentials: { ...original!.credentials!, refreshStartedAt: 0 } })
          .where(eq(mcpConnection.id, reference.id))
        await expect(
          authority((service) => service.getCredential({ actor, reference })),
        ).rejects.toThrow()
        expect(fixture.state.refreshes).toBe(0)
        await db
          .update(mcpConnection)
          .set({ credentials: original!.credentials })
          .where(eq(mcpConnection.id, reference.id))
        fixture.state[failure] = true
        await expect(
          authority((service) => service.getCredential({ actor, reference })),
        ).rejects.toThrow()
        await expect(
          authority((service) => service.getCredential({ actor, reference })),
        ).rejects.toThrow()
        expect(fixture.state.refreshes).toBe(1)
        expect(
          (await connections((service) => service.catalog(actor))).connections[0]!.authState,
        ).toBe("reauthorization_required")
      },
    )
    test("SDK authorization errors do not log raw provider descriptions", async () => {
      const { reference } = await createOAuth()
      const flow = await authorize(reference)
      fixture.state.authorizationError = "invalid_grant"
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
      try {
        await expect(callback(flow)).rejects.toThrow()
        expect(warning).toHaveBeenCalled()
        expect(JSON.stringify(warning.mock.calls)).not.toContain("private-provider-description")
      } finally {
        warning.mockRestore()
      }
    })
    test.each([
      "invalid_grant",
      "invalid_client",
      "unauthorized_client",
      "invalid_scope",
      "invalid_request",
      "unsupported_grant_type",
    ])("%s clears the unusable grant", async (error) => {
      const { reference } = await connectedOAuth()
      await expire(reference)
      fixture.state.refreshError = error
      await expect(
        authority((service) => service.getCredential({ actor, reference })),
      ).rejects.toThrow()
      expect((await db.select().from(mcpConnection))[0]!.credentials).toBeNull()
      expect(
        (await connections((service) => service.catalog(actor))).connections[0]!.authState,
      ).toBe("reauthorization_required")
    })
    test.each(["expired", "rejected"])(
      "%s tokens without a refresh token require reconnecting without losing registration",
      async (reason) => {
        fixture.state.authorizationRefreshToken = null
        const { reference } = await connectedOAuth()
        if (reason === "expired") await expire(reference)
        await expect(
          authority((service) =>
            service.getCredential({
              actor,
              reference,
              ...(reason === "rejected" ? { rejectedToken: "access-0" } : {}),
            }),
          ),
        ).rejects.toThrow()
        await expect(
          authority((service) => service.getCredential({ actor, reference })),
        ).rejects.toThrow()
        expect(fixture.state.refreshes).toBe(0)
        expect(
          (await connections((service) => service.catalog(actor))).connections[0]!.authState,
        ).toBe("reauthorization_required")
        const [stored] = await db.select().from(mcpConnection)
        expect(stored!.credentials!.credential).toMatchObject({
          kind: "oauth",
          clientInformation: { client_id: "registered-1" },
        })
      },
    )
    test("private static credentials stay isolated and cannot be transplanted", async () => {
      await expect(
        connections((service) =>
          service.createServer(actor.organizationId, {
            endpointUrl: "https://fixture.example/mcp",
            authConfig: { kind: "static_headers", headerNames: ["Authorization", "Authorization"] },
          }),
        ),
      ).rejects.toThrow()
      const server = await connections((service) =>
        service.createServer(actor.organizationId, {
          endpointUrl: "https://fixture.example/mcp",
          authConfig: { kind: "static_headers", headerNames: ["Authorization"] },
        }),
      )
      const account = await connections((service) => service.createConnection(actor, server.id))
      await connections((service) =>
        service.setHeaders({
          actor,
          reference: account,
          lockVersion: 0,
          headers: { Authorization: "Bearer personal-secret" },
        }),
      )
      const [otherUser] = await db
        .insert(tenantUser)
        .values({
          organizationId: actor.organizationId,
          tenantId: actor.tenantId,
          externalId: "other",
        })
        .returning()
      const other = { ...actor, tenantUserId: otherUser!.id }
      expect((await connections((service) => service.catalog(other))).connections).toEqual([])
      await expect(
        authority((service) => service.getCredential({ actor: other, reference: account })),
      ).rejects.toThrow()
      const second = await connections((service) => service.createConnection(other, server.id))
      const [cipher] = await db
        .select({ value: sql<string>`${mcpConnection.credentials}::text` })
        .from(mcpConnection)
        .where(eq(mcpConnection.id, account.id))
      await db.execute(
        sql`update mcp_connection set credentials = ${cipher!.value}, lock_version = 1 where id = ${second.id}`,
      )
      await expect(
        authority((service) => service.getCredential({ actor: other, reference: second })),
      ).rejects.toThrow()
      expect(JSON.stringify(await connections((service) => service.catalog(actor)))).not.toContain(
        "personal-secret",
      )
      await expect(
        connections((service) =>
          service.setHeaders({
            actor,
            reference: account,
            lockVersion: 0,
            headers: { Authorization: "stale" },
          }),
        ),
      ).rejects.toThrow()
    })
    test("public connections reconnect and Tenant and Organization deletion cascade through commit", async () => {
      const server = await connections((service) =>
        service.createServer(actor.organizationId, {
          endpointUrl: "https://fixture.example/mcp",
          authConfig: { kind: "none" },
        }),
      )
      const account = await connections((service) => service.createConnection(actor, server.id))
      await authority((service) => service.disconnect({ actor, reference: account }))
      const reconnected = await connections((service) => service.createConnection(actor, server.id))
      expect(reconnected).toMatchObject({ authState: "connected", lockVersion: 0 })
      expect(reconnected.id).not.toBe(account.id)
      expect((await db.select().from(mcpConnection))[0]!.credentials).toBeNull()
      expect(
        Redacted.value(
          await authority((service) => service.getCredential({ actor, reference: reconnected })),
        ),
      ).toEqual({ kind: "none" })
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`set constraints all deferred`)
        await transaction.delete(tenant).where(eq(tenant.id, actor.tenantId))
      })
      expect(await db.select().from(mcpConnection)).toEqual([])
      const [customer] = await db
        .insert(tenant)
        .values({ organizationId: actor.organizationId, externalId: "new" })
        .returning()
      const [person] = await db
        .insert(tenantUser)
        .values({ organizationId: actor.organizationId, tenantId: customer!.id, externalId: "new" })
        .returning()
      await connections((service) =>
        service.createConnection(
          { ...actor, tenantId: customer!.id, tenantUserId: person!.id },
          server.id,
        ),
      )
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`set constraints all deferred`)
        await transaction.delete(organization).where(eq(organization.id, actor.organizationId))
      })
      expect(await db.select().from(mcpConnection)).toEqual([])
    })
  },
)
