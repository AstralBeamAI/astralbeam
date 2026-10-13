import { and, eq, sql } from "drizzle-orm"
import { spawn } from "node:child_process"
import { Effect, Layer, ManagedRuntime, Redacted } from "effect"
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
import { organization, organizationConfiguration, tenant, tenantUser } from "@/db/schema"
import { mcpConnection, mcpOAuthAttempt, tenantMcpConnection } from "@/db/schema/mcp"
import { Config } from "@/lib/config/config"
import { McpConnections } from "./mcp.server.ts"
import { McpAuthorization } from "./authorization/authorization.ts"
import { startMcpFixture } from "./testing/fixture.ts"
import type { McpActor, McpReference, McpConnectionSummary } from "./schemas.ts"

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
  "durable MCP connections and OAuth",
  () => {
    const runtime = ManagedRuntime.make(mcpPersistenceLayer)
    let db: ReturnType<typeof getAuthDatabase>
    let fixture: Awaited<ReturnType<typeof startMcpFixture>>
    let actor: McpActor
    let person: McpActor
    beforeEach(async () => {
      mcpIntegration.baseUrl = "https://astralbeam.example"
      db = getAuthDatabase()
      await db.execute(sql`truncate organization cascade`)
      const [org] = await db.insert(organization).values({ name: "MCP", slug: "mcp" }).returning()
      await db.insert(organizationConfiguration).values({ organizationId: org!.id })
      const [customer] = await db
        .insert(tenant)
        .values({ organizationId: org!.id, externalId: "tenant" })
        .returning()
      const [user] = await db
        .insert(tenantUser)
        .values({ organizationId: org!.id, tenantId: customer!.id, externalId: "person" })
        .returning()
      actor = {
        organizationId: org!.id,
        tenantId: null,
        tenantUserId: null,
        organizationUserId: "019a0000-0000-7000-8000-000000000002",
        admin: true,
        apiKey: false,
        interactive: true,
      }
      person = {
        ...actor,
        organizationUserId: null,
        tenantId: customer!.id,
        tenantUserId: user!.id,
        admin: false,
      }
      fixture = await startMcpFixture()
      mcpIntegration.fetch = fixture.fetch
    })
    afterEach(async () => {
      await fixture.close()
    })
    afterAll(async () => {
      await runtime.dispose()
    })
    const connections = <A, E>(
      use: (service: typeof McpConnections.Service) => Effect.Effect<A, E>,
    ) => runtime.runPromise(Effect.flatMap(McpConnections, use))
    const authority = <A, E>(
      use: (service: typeof McpAuthorization.Service) => Effect.Effect<A, E>,
    ) => runtime.runPromise(Effect.flatMap(McpAuthorization, use))
    async function createOAuth(cimd = false, manual = false) {
      fixture.state.oauth = true
      fixture.state.cimd = cimd
      const server = await connections((service) =>
        service.saveServer({
          actor,
          owner: actor,
          fields: {
            name: "OAuth",
            endpointUrl: "https://fixture.example/mcp",
            enabled: true,
            defaultConnectionScope: "organization",
            authConfig: {
              kind: "oauth",
              profile: manual ? "google" : "standard",
              registration: manual ? "pre_registered" : "automatic",
              requestedScopes: ["read"],
            },
          },
        }),
      )
      if (manual)
        await authority((service) =>
          service.configureClient({
            actor,
            reference: server,
            manualClient: {
              clientId: "manual-client",
              clientSecret: "manual-secret",
              tokenEndpointAuthMethod: "client_secret_post",
            },
          }),
        )
      const connection = await connections((service) =>
        service.saveConnection({
          actor,
          owner: actor,
          fields: { name: "Account", serverId: server.id, serverTenantId: null, enabled: true },
        }),
      )
      return { server, reference: connection as McpReference }
    }
    async function authorize(reference: McpReference) {
      const started = await authority((service) => service.start({ actor, reference }))
      const [attempt] = await db
        .select()
        .from(mcpOAuthAttempt)
        .where(eq(mcpOAuthAttempt.id, started.attempt.id))
      const challenge = "b".repeat(43)
      await authority((service) =>
        service.bindBrowser({ actor, reference: started.attempt, challenge }),
      )
      const params = new URLSearchParams({
        state: attempt!.payload!.state,
        code: "authorization-code",
        iss: "https://fixture.example",
      })
      return { started, attempt: attempt!, challenge, params }
    }
    async function connectedOAuth() {
      const created = await createOAuth()
      const flow = await authorize(created.reference)
      await authority((service) =>
        service.callback({ params: flow.params, browserBinding: flow.challenge }),
      )
      await authority((service) => service.complete({ actor, reference: flow.started.attempt }))
      return created
    }
    async function expire(reference: McpReference) {
      const [row] = await db.select().from(mcpConnection).where(eq(mcpConnection.id, reference.id))
      const envelope = row!.credentials!
      if (envelope.credential.kind !== "oauth") throw new Error("OAuth fixture required")
      await db
        .update(mcpConnection)
        .set({
          credentials: { ...envelope, credential: { ...envelope.credential, expiresAt: 0 } },
          expiresAt: new Date(0),
        })
        .where(eq(mcpConnection.id, reference.id))
    }
    test.each([
      [false, false, "https://astralbeam.example"],
      [false, false, "http://localhost:18407"],
      [true, false, "https://astralbeam.example"],
      [false, true, "https://astralbeam.example"],
    ])(
      "supports DCR, CIMD and manual Google applications, cimd=%s manual=%s base=%s",
      async (cimd, manual, baseUrl) => {
        mcpIntegration.baseUrl = baseUrl
        const { reference } = await createOAuth(cimd, manual)
        const flow = await authorize(reference)
        expect(flow.attempt.payload!.verifier).toBeTruthy()
        const destination = new URL(flow.attempt.payload!.authorizationUrl!)
        expect(destination.searchParams.get("code_challenge_method")).toBe("S256")
        expect(destination.searchParams.get("resource")).toBe("https://fixture.example/mcp")
        expect(destination.searchParams.get("access_type")).toBe(manual ? "offline" : null)
        expect(destination.searchParams.get("prompt")).toBe(manual ? "consent" : null)
        await expect(
          authority((service) =>
            service.callback({ params: flow.params, browserBinding: "wrong" }),
          ),
        ).rejects.toThrow()
        expect(fixture.state.tokenRequests).toBe(0)
        await authority((service) =>
          service.callback({ params: flow.params, browserBinding: flow.challenge }),
        )
        await expect(
          authority((service) =>
            service.callback({ params: flow.params, browserBinding: flow.challenge }),
          ),
        ).rejects.toThrow()
        await authority((service) => service.complete({ actor, reference: flow.started.attempt }))
        const safe = await connections((service) =>
          service.listConnections({ actor, owner: actor }),
        )
        expect(JSON.stringify(safe)).not.toContain("access-0")
        expect(safe[0]!.grantedScopes).toEqual(["read"])
        expect(fixture.state.registrations).toBe(cimd || manual ? 0 : 1)
      },
    )
    test("reconnect never combines a new account's access token with the previous refresh token", async () => {
      const { reference } = await connectedOAuth()
      const { connection: original } = await connections((service) =>
        service.getConnection({ actor, reference }),
      )
      fixture.state.authorizationToken = "another-account"
      fixture.state.authorizationRefreshToken = null
      const flow = await authorize(reference)
      await authority((service) =>
        service.callback({ params: flow.params, browserBinding: flow.challenge }),
      )
      await authority((service) => service.complete({ actor, reference: flow.started.attempt }))
      await expect(
        authority((service) =>
          service.getCredential({ actor, reference, expectedGeneration: original.authGeneration }),
        ),
      ).rejects.toThrow()
      const credential = Redacted.value(
        await authority((service) => service.getCredential({ actor, reference })),
      )
      expect(credential).toMatchObject({ tokens: { access_token: "another-account" } })
      if (credential?.kind !== "oauth") throw new Error("OAuth fixture required")
      expect(credential.tokens.refresh_token).toBeUndefined()
      await expire(reference)
      await expect(
        authority((service) => service.getCredential({ actor, reference })),
      ).rejects.toThrow()
      expect(fixture.state.refreshes).toBe(0)
      expect(
        (await connections((service) => service.listConnections({ actor, owner: actor })))[0]!
          .authState,
      ).toBe("reauthorization_required")
    })
    test("disconnect wins over a refresh in flight and never restores deleted credentials", async () => {
      const { reference } = await connectedOAuth()
      await expire(reference)
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      fixture.state.tokenGate = () => gate
      const pending = authority((service) => service.getCredential({ actor, reference }))
      const rejected = pending.then(
        () => false,
        () => true,
      )
      await vi.waitFor(() => expect(fixture.state.refreshes).toBe(1))
      await connections((service) => service.disconnect({ actor, reference }))
      release()
      expect(await rejected).toBe(true)
      const [row] = await db.select().from(mcpConnection).where(eq(mcpConnection.id, reference.id))
      expect(row!.authState).toBe("disconnected")
      expect(row!.credentials).toBeNull()
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
        expect(row!.tokenRevision).toBe(1)
        expect(row!.lockVersion).toBe(0)
        expect(row!.credentials!.tokenRevision).toBe(1)
      } finally {
        release()
        for (const { child } of processes) if (child.exitCode === null) child.kill("SIGTERM")
      }
    }, 60_000)
    test("does not redeem an expired refresh claim again and classifies lost responses as uncertain", async () => {
      const { reference } = await connectedOAuth()
      await expire(reference)
      await db
        .update(mcpConnection)
        .set({ refreshClaimId: crypto.randomUUID(), refreshClaimExpiresAt: new Date(0) })
        .where(eq(mcpConnection.id, reference.id))
      await expect(
        authority((service) => service.getCredential({ actor, reference })),
      ).rejects.toThrow()
      expect(fixture.state.refreshes).toBe(0)
      expect(
        (await connections((service) => service.listConnections({ actor, owner: actor })))[0]!
          .authState,
      ).toBe("refresh_uncertain")
      await db
        .update(mcpConnection)
        .set({ authState: "connected", refreshClaimId: null, refreshClaimExpiresAt: null })
        .where(eq(mcpConnection.id, reference.id))
      fixture.state.disconnectResponse = true
      await expect(
        authority((service) => service.getCredential({ actor, reference })),
      ).rejects.toThrow()
      expect(
        (await connections((service) => service.listConnections({ actor, owner: actor })))[0]!
          .authState,
      ).toBe("refresh_uncertain")
      expect(fixture.state.refreshes).toBe(1)
    })
    test("marks invalid_grant as requiring reconnection while retaining the encrypted credential", async () => {
      const { reference } = await connectedOAuth()
      await expire(reference)
      fixture.state.refreshError = "invalid_grant"
      await expect(
        authority((service) => service.getCredential({ actor, reference })),
      ).rejects.toThrow()
      const [row] = await db.select().from(mcpConnection).where(eq(mcpConnection.id, reference.id))
      expect(row!.authState).toBe("reauthorization_required")
      expect(row!.credentials).not.toBeNull()
    })
    test("blocks noninteractive API principals and stale or foreign callback authority", async () => {
      const { reference, server } = await connectedOAuth()
      await expect(
        authority((service) =>
          service.start({ actor: { ...actor, apiKey: true, interactive: false }, reference }),
        ),
      ).rejects.toThrow()
      const flow = await authorize(reference)
      await expect(
        authority((service) =>
          service.complete({ actor: person, reference: flow.started.attempt }),
        ),
      ).rejects.toThrow()
      await connections((service) =>
        service.saveServer({
          actor,
          owner: actor,
          id: server.id,
          fields: {
            ...server,
            endpointUrl: "https://fixture.example/changed",
            lockVersion: server.lockVersion,
          },
        }),
      )
      await expect(
        authority((service) =>
          service.callback({ params: flow.params, browserBinding: flow.challenge }),
        ),
      ).rejects.toThrow()
      expect(
        (await db.select().from(mcpConnection).where(eq(mcpConnection.id, reference.id)))[0]!
          .credentials,
      ).not.toBeNull()
    })
    test("rejects expired attempts and issuer substitution before exchanging a code", async () => {
      const { reference } = await createOAuth()
      const flow = await authorize(reference)
      const substituted = new URLSearchParams(flow.params)
      substituted.set("iss", "https://attacker.example")
      await expect(
        authority((service) =>
          service.callback({ params: substituted, browserBinding: flow.challenge }),
        ),
      ).rejects.toThrow()
      expect(fixture.state.tokenRequests).toBe(0)
      await db
        .update(mcpOAuthAttempt)
        .set({ expiresAt: new Date(0) })
        .where(eq(mcpOAuthAttempt.id, flow.started.attempt.id))
      await expect(
        authority((service) =>
          service.callback({ params: flow.params, browserBinding: flow.challenge }),
        ),
      ).rejects.toThrow()
      expect(fixture.state.tokenRequests).toBe(0)
    })
    test("rejects replacing an OAuth application without disrupting connected accounts", async () => {
      const { reference, server } = await connectedOAuth()
      await expect(
        authority((service) =>
          service.configureClient({
            actor,
            reference: server,
            manualClient: { clientId: "replacement", tokenEndpointAuthMethod: "none" },
          }),
        ),
      ).rejects.toThrow()
      expect(
        Redacted.value(await authority((service) => service.getCredential({ actor, reference }))),
      ).toMatchObject({ kind: "oauth", tokens: { access_token: "access-0" } })
    })
    test("reconnection wins over token rotation already in flight", async () => {
      const { reference } = await connectedOAuth()
      const flow = await authorize(reference)
      await authority((service) =>
        service.callback({ params: flow.params, browserBinding: flow.challenge }),
      )
      await expire(reference)
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      fixture.state.tokenGate = () => gate
      const pending = authority((service) => service.getCredential({ actor, reference })).then(
        () => false,
        () => true,
      )
      try {
        await vi.waitFor(() => expect(fixture.state.refreshes).toBe(1))
        await authority((service) => service.complete({ actor, reference: flow.started.attempt }))
      } finally {
        release()
      }
      expect(await pending).toBe(true)
      const [row] = await db.select().from(mcpConnection).where(eq(mcpConnection.id, reference.id))
      expect(row!.tokenRevision).toBe(0)
      expect(row!.credentials!.credential).toMatchObject({ tokens: { access_token: "access-0" } })
    })
    test("public defaults need no secret and Tenant shared accounts do not become personal accounts", async () => {
      const publicServer = await connections((service) =>
        service.saveServer({
          actor,
          owner: actor,
          fields: {
            name: "Public default",
            endpointUrl: "https://fixture.example/mcp",
            enabled: true,
            defaultConnectionScope: "organization",
            authConfig: { kind: "none" },
          },
        }),
      )
      const defaults = await connections((service) => service.catalog(person))
      await expect(
        connections((service) =>
          service.saveServer({
            actor,
            owner: actor,
            id: publicServer.id,
            fields: { ...publicServer, defaultConnectionScope: "tenant" },
          }),
        ),
      ).rejects.toThrow()
      const publicAccount = defaults.connections.find(
        (entry) => entry.serverId === publicServer.id,
      )!
      expect(publicAccount.allowedActions).toEqual([])
      expect(
        Redacted.value(
          await authority((service) =>
            service.getCredential({ actor: person, reference: publicAccount }),
          ),
        ),
      ).toBeNull()
      const crm = await connections((service) =>
        service.saveServer({
          actor,
          owner: actor,
          fields: {
            name: "CRM default",
            endpointUrl: "https://fixture.example/mcp",
            enabled: true,
            defaultConnectionScope: "tenant",
            authConfig: { kind: "static_headers", headerNames: ["Authorization"] },
          },
        }),
      )
      const sharedOwner = { ...person, tenantUserId: null }
      const account = await connections((service) =>
        service.saveConnection({
          actor: { ...person, admin: true },
          owner: sharedOwner,
          fields: {
            name: "Tenant CRM",
            serverId: crm.id,
            serverTenantId: null,
            enabled: true,
            headers: { Authorization: "Bearer workspace" },
          },
        }),
      )
      expect(
        Redacted.value(
          await authority((service) =>
            service.getCredential({ actor: person, reference: account }),
          ),
        ),
      ).toMatchObject({ headers: { Authorization: "Bearer workspace" } })
      await expect(
        connections((service) => service.disconnect({ actor: person, reference: account })),
      ).rejects.toThrow()
      await expect(
        authority((service) =>
          service.getCredential({
            actor: { ...person, tenantId: crypto.randomUUID() },
            reference: account,
          }),
        ),
      ).rejects.toThrow()
      await expect(
        connections((service) =>
          service.saveConnection({
            actor: person,
            owner: person,
            fields: {
              name: "Wrong owner",
              serverId: crm.id,
              serverTenantId: null,
              enabled: true,
              headers: { Authorization: "Bearer personal" },
            },
          }),
        ),
      ).rejects.toThrow()
      await db
        .delete(tenantUser)
        .where(
          and(
            eq(tenantUser.organizationId, person.organizationId),
            eq(tenantUser.tenantId, person.tenantId!),
            eq(tenantUser.id, person.tenantUserId!),
          ),
        )
      for (const reference of [publicAccount, account])
        await expect(
          authority((service) => service.getCredential({ actor: person, reference })),
        ).rejects.toThrow()
    })
    test("keeps multiple accounts isolated, rejects transplanted ciphertext and retains default access when BYO is disabled", async () => {
      await connections((service) =>
        service.savePolicy({
          actor,
          policy: { allowTenantMcpServers: false, allowTenantUserMcpServers: true, lockVersion: 0 },
        }),
      )
      const server = await connections((service) =>
        service.saveServer({
          actor: person,
          owner: person,
          fields: {
            name: "Personal",
            endpointUrl: "https://fixture.example/mcp",
            enabled: true,
            defaultConnectionScope: "tenant_user",
            authConfig: { kind: "static_headers", headerNames: ["Authorization"] },
          },
        }),
      )
      const accounts: McpConnectionSummary[] = []
      for (const name of ["Work", "Home"])
        accounts.push(
          await connections((service) =>
            service.saveConnection({
              actor: person,
              owner: person,
              fields: {
                name,
                serverId: server.id,
                serverTenantId: person.tenantId,
                enabled: true,
                headers: { Authorization: `Bearer ${name}` },
              },
            }),
          ),
        )
      const [otherUser] = await db
        .insert(tenantUser)
        .values({
          organizationId: person.organizationId,
          tenantId: person.tenantId!,
          externalId: "other",
        })
        .returning()
      for (const foreignActor of [
        { ...person, tenantUserId: otherUser!.id, admin: true },
        { ...actor, organizationUserId: null, apiKey: true },
      ]) {
        await expect(
          authority((service) =>
            service.getCredential({ actor: foreignActor, reference: accounts[0]! }),
          ),
        ).rejects.toThrow()
        await expect(
          connections((service) =>
            service.disconnect({ actor: foreignActor, reference: accounts[0]! }),
          ),
        ).rejects.toThrow()
      }
      const [ciphertext] = await db
        .select({ value: sql<string>`${tenantMcpConnection.credentials}::text` })
        .from(tenantMcpConnection)
        .where(eq(tenantMcpConnection.id, accounts[0]!.id))
      await db.execute(
        sql`update tenant_mcp_connection set credentials = ${ciphertext!.value} where id = ${accounts[1]!.id}`,
      )
      await expect(
        authority((service) => service.getCredential({ actor: person, reference: accounts[1]! })),
      ).rejects.toThrow()
      const policy = await connections((service) => service.policy(actor.organizationId))
      await connections((service) =>
        service.savePolicy({ actor, policy: { ...policy, allowTenantUserMcpServers: false } }),
      )
      await expect(
        authority((service) => service.getCredential({ actor: person, reference: accounts[0]! })),
      ).rejects.toThrow()
      await connections((service) => service.disconnect({ actor: person, reference: accounts[0]! }))
      await db
        .update(organization)
        .set({ slug: "renamed" })
        .where(eq(organization.id, actor.organizationId))
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`set constraints all deferred`)
        await transaction
          .delete(tenant)
          .where(
            and(eq(tenant.organizationId, person.organizationId), eq(tenant.id, person.tenantId!)),
          )
      })
      expect(await db.select().from(tenantMcpConnection)).toEqual([])
    })
  },
)
