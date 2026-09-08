import { createHash } from "node:crypto"

import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"
import { SignJWT } from "jose"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { runDatabaseEffect } from "@/db"

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
        orderBy: () => query,
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

import {
  authenticateChatRequest,
  isChatAuthenticationError,
  verifyChatAuthToken,
} from "./auth.server"
import { CHAT_AUTH_TOKEN_AUDIENCE, CHAT_AUTH_TOKEN_TYPE } from "./constants.server"
import {
  authenticateOrganizationRequest,
  verifyOrganizationToken,
} from "../organization-token.server"

const apiKeyId = "key_01990a5d-ac96-774b-b942-6b13c85384ca_01990a5d-ac96-774b-b942-6b13c85384c9"
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
      typ: overrides.type ?? CHAT_AUTH_TOKEN_TYPE,
      kid: overrides.apiKeyId ?? apiKeyId,
    })
    .setIssuer(overrides.issuer ?? "01990a5d-ac96-774b-b942-6b13c85384ca")
    .setAudience(overrides.audience ?? CHAT_AUTH_TOKEN_AUDIENCE)
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

  test("organization tokens share lifecycle checks but cannot authenticate as chat", async () => {
    const identity = { email: "operator@example.com", organizationId: apiKeyId.split("_")[1]! }
    const currentUser = {
      id: "organization-user",
      name: "Operator",
      email: identity.email,
      role: "developer",
    }
    const jwt = await token({
      version: 1,
      type: "astralbeam-organization+jwt",
      claims: { email: identity.email, organization_id: identity.organizationId },
    })
    await expect(verifyChatAuthToken(jwt, signingKey(), apiKeyId)).rejects.toThrow()
    await expect(verifyOrganizationToken(await token(), signingKey(), apiKeyId)).rejects.toThrow()
    const keyRow = [{
      id: apiKeyId.split("_")[2],
      digest: createHash("sha256").update(rawApiKey).digest("base64url"),
      organizationId: identity.organizationId,
    }]
    databaseState.rows = [
      keyRow,
      [{ enabled: true, expiresAt: null }],
      [currentUser],
      keyRow,
      [{ enabled: true, expiresAt: null }],
      [{ ...currentUser, role: "viewer" }],
      keyRow,
      [{ enabled: true, expiresAt: null }],
      [],
      keyRow,
      [{ enabled: false, expiresAt: null }],
    ]
    const authentication = authenticateOrganizationRequest(
      new Request("https://example.test/api/v1/tenants", {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    )
    await expect(runDatabaseEffect(authentication)).resolves.toMatchObject({
      organizationId: identity.organizationId,
      identity,
      currentUser,
    })
    const dialect = new PgDialect()
    const join = dialect.sqlToQuery(databaseState.joinPredicates.at(-1)!)
    expect(join.sql).toContain('"member"."user_id" = "user"."id"')
    expect(join.params).toEqual([identity.organizationId])
    expect(dialect.sqlToQuery(databaseState.wherePredicates.at(-1)!).params).toEqual([
      identity.email,
    ])
    await expect(runDatabaseEffect(authentication)).resolves.toMatchObject({
      currentUser: { ...currentUser, role: "viewer" },
    })
    await expect(runDatabaseEffect(authentication)).rejects.toMatchObject({
      _tag: "OrganizationMembershipError",
    })
    await expect(runDatabaseEffect(authentication)).rejects.toThrow()
    expect(databaseState.selectCalls).toBe(11)
    expect(databaseState.mutationCalls).toBe(0)
  })

  test("organization verifier rejects invalid version, lifetime, issuer, audience and extra identity claims", async () => {
    const defaults = {
      type: "astralbeam-organization+jwt",
      version: 1,
      claims: { email: "operator@example.com", organization_id: apiKeyId.split("_")[1]! },
    }
    for (
      const override of [
        { version: 2 },
        { expiresInSeconds: 601 },
        { expiresInSeconds: 59 },
        { issuedAt: 1 },
        { issuer: "another-org" },
        { audience: "chat" },
        { claims: { ...defaults.claims, tenant: { id: "t" } } },
        { claims: { ...defaults.claims, role: "owner" } },
        { claims: { ...defaults.claims, roles: ["owner"] } },
        { claims: { ...defaults.claims, admin: true } },
        { claims: { ...defaults.claims, organization_id: "another-org" } },
        { claims: { ...defaults.claims, email: "invalid" } },
        { claims: { ...defaults.claims, email: "owner\u0000@example.com" } },
        { claims: { organization_id: defaults.claims.organization_id } },
        { claims: { email: defaults.claims.email } },
        { subject: "old-user-id" },
        { algorithm: "HS384" as const },
        { signingSecret: "wrong" },
      ]
    ) {
      await expect(
        verifyOrganizationToken(await token({ ...defaults, ...override }), signingKey(), apiKeyId),
      ).rejects.toThrow()
    }
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
        new Request("https://example.test/api/v1/chat", {
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
    expect(joinPredicate?.sql).toContain('"api_key"."id" = $1')
    expect(joinPredicate?.sql).toContain('"api_key"."config_id" = $2')
    expect(joinPredicate?.params).toEqual(["01990a5d-ac96-774b-b942-6b13c85384c9", "default"])
    expect(lookupPredicate?.sql).toContain('"organization"."id" = $1')
    expect(lookupPredicate?.params).toEqual(["01990a5d-ac96-774b-b942-6b13c85384ca"])
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
        new Request("https://example.test/api/v1/chat", {
          headers: { authorization: `Bearer ${await token()}` },
        }),
      ),
    ).rejects.toSatisfy(isChatAuthenticationError)
    expect(databaseState.mutationCalls).toBe(0)
  })

  test("does not require or interpret the optional JWT subject", async () => {
    await expect(
      verifyChatAuthToken(await token({ subject: "host-defined-subject" }), signingKey(), apiKeyId),
    ).resolves.toEqual(defaultTenantUser)
  })

  test("accepts deeply nested metadata", async () => {
    await expect(
      verifyChatAuthToken(await token({ user: deeplyNestedUser }), signingKey(), apiKeyId),
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
    await expect(verifyChatAuthToken(await token(overrides), signingKey(), apiKeyId)).rejects
      .toSatisfy(isChatAuthenticationError)
  })

  test("rejects legacy key IDs before querying", async () => {
    await expect(authenticateChatRequest(
      new Request("https://example.test/api/v1/chat", {
        headers: { authorization: `Bearer ${await token({ apiKeyId: "key_acme_production" })}` },
      }),
    )).rejects.toSatisfy(isChatAuthenticationError)
    expect(databaseState.selectCalls).toBe(0)
  })

  test("rejects malformed tokens", async () => {
    await expect(verifyChatAuthToken("not-a-jwt", signingKey(), apiKeyId)).rejects.toSatisfy(
      isChatAuthenticationError,
    )
  })
})

function query(expression: SQL) {
  return new PgDialect().sqlToQuery(expression)
}
