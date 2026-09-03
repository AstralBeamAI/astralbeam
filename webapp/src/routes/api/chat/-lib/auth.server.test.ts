import { createHash } from "node:crypto"

import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"
import { SignJWT } from "jose"
import { beforeEach, describe, expect, test, vi } from "vitest"

const databaseState = vi.hoisted(() => ({
  joinPredicates: [] as SQL[],
  mutationCalls: 0,
  rows: [] as unknown[][],
  selectCalls: 0,
  wherePredicates: [] as SQL[],
}))

vi.mock("@/db", () => {
  const db = {
    select: () => {
      const rows = databaseState.rows[databaseState.selectCalls++] ?? []
      const query = {
        from: () => query,
        innerJoin: (_table: unknown, predicate: SQL) => {
          databaseState.joinPredicates.push(predicate)
          return query
        },
        where: (predicate: SQL) => {
          databaseState.wherePredicates.push(predicate)
          return query
        },
        limit: () => Effect.succeed(rows),
      }
      return query
    },
    update: () => {
      databaseState.mutationCalls += 1
      throw new Error("Chat authentication must not update API-key usage")
    },
  }
  return {
    effectDatabase: Effect.succeed(db),
    runDatabaseEffect: Effect.runPromise,
  }
})

import { authenticateChatRequest, isChatAuthenticationError, verifyChatToken } from "./auth.server"
import { CHAT_TOKEN_AUDIENCE, CHAT_TOKEN_TYPE } from "./constants.server"

const apiKeyId = "key_acme-corp_production-key"
const rawApiKey = `abo_${"A".repeat(64)}`
const defaultUser = {
  id: "tenant-user-1",
  metadata: { role: "admin" },
}
const defaultTenant = {
  id: "tenant-1",
  name: "Acme customer",
  metadata: { plan: "enterprise" },
}
const defaultTenantUser = { ...defaultUser, tenant: defaultTenant }
let deeplyNestedUser: unknown = { ...defaultUser }
for (let depth = 0; depth < 50; depth += 1) {
  deeplyNestedUser = {
    ...defaultUser,
    metadata: { child: deeplyNestedUser },
  }
}

function signingKey(secret = rawApiKey) {
  return new TextEncoder().encode(createHash("sha256").update(secret).digest("base64url"))
}

type TokenOverrides = {
  algorithm?: "HS256" | "HS384"
  apiKeyId?: string
  audience?: string
  claims?: Record<string, unknown>
  expiresAt?: number
  expiresInSeconds?: number
  issuedAt?: number
  issuer?: string
  signingSecret?: string
  subject?: string
  tenant?: unknown
  type?: string
  user?: unknown
  version?: number
}

async function token(overrides: TokenOverrides = {}) {
  const now = Math.floor(Date.now() / 1_000)
  const issuedAt = overrides.issuedAt ?? now
  const algorithm = overrides.algorithm ?? "HS256"
  const claims = overrides.claims ?? {
    user: overrides.user ?? defaultUser,
    tenant: overrides.tenant ?? defaultTenant,
  }
  let jwt = new SignJWT({
    ver: overrides.version ?? 4,
    ...claims,
  })
    .setProtectedHeader({
      alg: algorithm,
      typ: overrides.type ?? CHAT_TOKEN_TYPE,
      kid: overrides.apiKeyId ?? apiKeyId,
    })
    .setIssuer(overrides.issuer ?? "acme-corp")
    .setAudience(overrides.audience ?? CHAT_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(
      overrides.expiresAt ?? issuedAt + (overrides.expiresInSeconds ?? 300),
    )
  if (overrides.subject !== undefined) jwt = jwt.setSubject(overrides.subject)
  return await jwt.sign(signingKey(overrides.signingSecret))
}

describe("organization API-key chat JWTs", () => {
  beforeEach(() => {
    databaseState.joinPredicates = []
    databaseState.mutationCalls = 0
    databaseState.rows = []
    databaseState.selectCalls = 0
    databaseState.wherePredicates = []
  })

  test("authenticates through a lifecycle reread without consuming API-key usage", async () => {
    databaseState.rows = [
      [{
        id: "01990a5d-ac96-774b-b942-6b13c85384c9",
        digest: createHash("sha256").update(rawApiKey).digest("base64url"),
        organizationId: "01990a5d-ac96-774b-b942-6b13c85384ca",
      }],
      [{ enabled: true, expiresAt: null }],
    ]

    await expect(
      authenticateChatRequest(
        new Request("https://example.test/api/chat", {
          headers: { authorization: `Bearer ${await token()}` },
        }),
      ),
    ).resolves.toEqual({
      organization: { id: "01990a5d-ac96-774b-b942-6b13c85384ca" },
      tenantUser: defaultTenantUser,
    })
    expect(databaseState.selectCalls).toBe(2)
    expect(databaseState.mutationCalls).toBe(0)
    const [joinPredicate] = databaseState.joinPredicates.map(query)
    const [lookupPredicate, lifecyclePredicate] = databaseState.wherePredicates.map(query)
    expect(joinPredicate?.sql).toContain('"api_key"."organization_id" = "organization"."id"')
    expect(joinPredicate?.sql).toContain('"api_key"."slug" = $1')
    expect(joinPredicate?.sql).toContain('"api_key"."config_id" = $2')
    expect(joinPredicate?.params).toEqual(["production-key", "default"])
    expect(lookupPredicate?.sql).toContain('"organization"."slug" = $1')
    expect(lookupPredicate?.params).toEqual(["acme-corp"])
    expect(lifecyclePredicate?.sql).toContain('"api_key"."id" = $1')
    expect(lifecyclePredicate?.sql).toContain('"api_key"."organization_id" = $2')
    expect(lifecyclePredicate?.params).toEqual([
      "01990a5d-ac96-774b-b942-6b13c85384c9",
      "01990a5d-ac96-774b-b942-6b13c85384ca",
    ])
  })

  test.each([
    ["missing", undefined],
    ["disabled", { enabled: false, expiresAt: null }],
    ["expired", { enabled: true, expiresAt: new Date(0) }],
  ])("rejects a %s API key during the lifecycle reread", async (_name, current) => {
    databaseState.rows = [
      [{
        id: "01990a5d-ac96-774b-b942-6b13c85384c9",
        digest: createHash("sha256").update(rawApiKey).digest("base64url"),
        organizationId: "01990a5d-ac96-774b-b942-6b13c85384ca",
      }],
      current ? [current] : [],
    ]

    await expect(
      authenticateChatRequest(
        new Request("https://example.test/api/chat", {
          headers: { authorization: `Bearer ${await token()}` },
        }),
      ),
    ).rejects.toSatisfy(isChatAuthenticationError)
    expect(databaseState.mutationCalls).toBe(0)
  })

  test("uses Better Auth's stored digest as the verifier and accepts v4 claims", async () => {
    await expect(verifyChatToken(await token(), signingKey(), apiKeyId)).resolves.toEqual(
      defaultTenantUser,
    )
  })

  test("does not require or interpret the optional JWT subject", async () => {
    await expect(
      verifyChatToken(await token({ subject: "host-defined-subject" }), signingKey(), apiKeyId),
    ).resolves.toEqual(defaultTenantUser)
  })

  test("accepts deeply nested metadata", async () => {
    await expect(
      verifyChatToken(await token({ user: deeplyNestedUser }), signingKey(), apiKeyId),
    ).resolves.toEqual({ ...(deeplyNestedUser as object), tenant: defaultTenant })
  })

  test.each([
    ["expired", { issuedAt: 1, expiresAt: 2 }],
    ["future dated", { issuedAt: Math.floor(Date.now() / 1_000) + 120 }],
    ["wrong algorithm", { algorithm: "HS384" as const }],
    ["wrong audience", { audience: "another-service" }],
    ["wrong issuer", { issuer: "another-issuer" }],
    ["wrong type", { type: "another+jwt" }],
    ["wrong kid", { apiKeyId: "key_acme_another" }],
    ["wrong signature", { signingSecret: `abo_${"B".repeat(64)}` }],
    ["old version", { version: 3 }],
    ["too short", { expiresInSeconds: 59 }],
    ["too long", { expiresInSeconds: 601 }],
    ["missing user ID", { user: {} }],
    ["missing tenant ID", { tenant: {} }],
    [
      "user fields outside metadata",
      { user: { ...defaultUser, role: "admin" } },
    ],
    [
      "tenant fields outside metadata",
      { tenant: { ...defaultTenant, plan: "enterprise" } },
    ],
    ["legacy nested tenant user", { claims: { tenantUser: defaultTenantUser } }],
  ])("rejects %s", async (_name, overrides) => {
    await expect(verifyChatToken(await token(overrides), signingKey(), apiKeyId)).rejects
      .toSatisfy(isChatAuthenticationError)
  })

  test("rejects malformed tokens", async () => {
    await expect(verifyChatToken("not-a-jwt", signingKey(), apiKeyId)).rejects.toSatisfy(
      isChatAuthenticationError,
    )
  })
})

function query(expression: SQL) {
  return new PgDialect().sqlToQuery(expression)
}
