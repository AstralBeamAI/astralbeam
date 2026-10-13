import { createHash } from "node:crypto"

import { assert, describe, it } from "@effect/vitest"
import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { Effect, Layer } from "effect"
import { SignJWT } from "jose"

import { Database, type EffectDatabase } from "@/db/database"
import {
  authenticateOrganizationRequest,
  verifyOrganizationToken,
} from "../auth/organization-token.server"
import { authenticateChatRequest, verifyChatAuthToken } from "./auth"
import { CHAT_AUTH_TOKEN_AUDIENCE, CHAT_AUTH_TOKEN_TYPE } from "./constants"

const ORGANIZATION_ID = "01990a5d-ac96-774b-b942-6b13c85384ca"
const KEY_ID = "01990a5d-ac96-774b-b942-6b13c85384c9"
const apiKeyId = `key_${ORGANIZATION_ID}_${KEY_ID}`
const rawApiKey = `abo_${"A".repeat(64)}`
const storedDigest = createHash("sha256").update(rawApiKey).digest("base64url")
const defaultUser = { id: "tenant-user-1", metadata: { role: "admin" } }
const defaultTenant = { id: "tenant-1", name: "Acme customer", metadata: { plan: "enterprise" } }
const defaultTenantUser = { ...defaultUser, tenant: defaultTenant }
const keyRow = { id: KEY_ID, digest: storedDigest, organizationId: ORGANIZATION_ID }
let deeplyNestedUser: unknown = { ...defaultUser }
for (let depth = 0; depth < 50; depth += 1) {
  deeplyNestedUser = { ...defaultUser, metadata: { child: deeplyNestedUser } }
}

function signingKey(secret = rawApiKey) {
  return new TextEncoder().encode(createHash("sha256").update(secret).digest("base64url"))
}

interface ChatTestTokenOverrides {
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

function signChatTestToken(overrides: ChatTestTokenOverrides = {}) {
  const issuedAt = overrides.issuedAt ?? Math.floor(Date.now() / 1_000)
  const claims = overrides.claims ?? {
    user: overrides.user ?? defaultUser,
    tenant: overrides.tenant ?? defaultTenant,
  }
  const jwt = new SignJWT({ ver: overrides.version ?? 4, ...claims })
    .setProtectedHeader({
      alg: overrides.algorithm ?? "HS256",
      typ: overrides.type ?? CHAT_AUTH_TOKEN_TYPE,
      kid: overrides.apiKeyId ?? apiKeyId,
    })
    .setIssuer(overrides.issuer ?? ORGANIZATION_ID)
    .setAudience(overrides.audience ?? CHAT_AUTH_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(overrides.expiresAt ?? issuedAt + (overrides.expiresInSeconds ?? 300))
  if (overrides.subject !== undefined) jwt.setSubject(overrides.subject)
  return Effect.promise(() => jwt.sign(signingKey(overrides.signingSecret)))
}

function chatRequest(token: string) {
  return new Request("https://example.test/api/v1/chat", {
    headers: { authorization: `Bearer ${token}` },
  })
}

// Serves queued rows to each select and records its predicates, and any write fails the test.
function recordingDatabase(rows: readonly (readonly unknown[])[]) {
  const recorded = { joins: [] as SQL[], wheres: [] as SQL[], selects: 0 }
  const select = () => {
    const result = rows[recorded.selects++] ?? []
    const query = {
      from: () => query,
      innerJoin: (_table: unknown, predicate: SQL) => {
        recorded.joins.push(predicate)
        return query
      },
      where: (predicate: SQL) => {
        recorded.wheres.push(predicate)
        return query
      },
      orderBy: () => query,
      limit: () => Effect.succeed(result),
    }
    return query
  }
  const database = { select } as unknown as EffectDatabase
  return { recorded, layer: Layer.succeed(Database, database) }
}

function chatAuthSql(expression: SQL | undefined) {
  return new PgDialect().sqlToQuery(expression!)
}

const verifyWithStoredKey = (token: string) => verifyChatAuthToken(token, signingKey(), apiKeyId)

describe("organization API-key chat JWTs", () => {
  it.effect("organization tokens share lifecycle checks but cannot authenticate as chat", () => {
    const identity = { email: "operator@example.com", organizationId: ORGANIZATION_ID }
    const currentUser = {
      id: "organization-user",
      name: "Operator",
      email: identity.email,
      role: "developer",
    }
    const { recorded, layer } = recordingDatabase([
      [keyRow],
      [{ enabled: true, expiresAt: null }],
      [currentUser],
      [keyRow],
      [{ enabled: true, expiresAt: null }],
      [],
      [keyRow],
      [{ enabled: false, expiresAt: null }],
    ])
    return Effect.gen(function* () {
      const jwt = yield* signChatTestToken({
        version: 1,
        type: "astralbeam-organization+jwt",
        claims: { email: identity.email, organization_id: identity.organizationId },
      })
      assert.strictEqual(
        (yield* Effect.flip(verifyWithStoredKey(jwt)))._tag,
        "ChatAuthenticationError",
      )
      yield* Effect.flip(
        verifyOrganizationToken(yield* signChatTestToken(), signingKey(), apiKeyId),
      )
      const authentication = authenticateOrganizationRequest(chatRequest(jwt))
      const principal = yield* authentication
      assert.deepStrictEqual(principal.identity, identity)
      assert.deepStrictEqual(principal.currentUser, currentUser)
      const join = chatAuthSql(recorded.joins.at(-1))
      assert.include(join.sql, '"member"."user_id" = "user"."id"')
      assert.deepStrictEqual(join.params, [identity.organizationId])
      assert.deepStrictEqual(chatAuthSql(recorded.wheres.at(-1)).params, [identity.email])
      const nonMember = yield* Effect.flip(authentication)
      assert.strictEqual(nonMember._tag, "OrganizationMembershipError")
      const disabled = yield* Effect.flip(authentication)
      assert.strictEqual(disabled._tag, "ChatAuthenticationError")
    }).pipe(Effect.provide(layer))
  })

  it.effect(
    "organization verifier rejects invalid version, lifetime, issuer, audience and extra identity claims",
    () =>
      Effect.gen(function* () {
        const defaults = {
          type: "astralbeam-organization+jwt",
          version: 1,
          claims: { email: "operator@example.com", organization_id: ORGANIZATION_ID },
        }
        for (const override of [
          { version: 2 },
          { expiresInSeconds: 601 },
          { expiresInSeconds: 59 },
          { issuedAt: 1 },
          { issuer: "another-org" },
          { audience: "chat" },
          { claims: { ...defaults.claims, tenant: { id: "t" } } },
          { claims: { ...defaults.claims, role: "owner" } },
          { claims: { ...defaults.claims, organization_id: "another-org" } },
          { claims: { ...defaults.claims, email: "invalid" } },
          { claims: { ...defaults.claims, email: "owner\u0000@example.com" } },
          { claims: { organization_id: defaults.claims.organization_id } },
          { claims: { email: defaults.claims.email } },
          { subject: "old-user-id" },
          { algorithm: "HS384" as const },
          { signingSecret: "wrong" },
        ]) {
          const jwt = yield* signChatTestToken({ ...defaults, ...override })
          yield* Effect.flip(verifyOrganizationToken(jwt, signingKey(), apiKeyId))
        }
      }),
  )

  it.effect("authenticates through a lifecycle reread without consuming API-key usage", () => {
    const { recorded, layer } = recordingDatabase([[keyRow], [{ enabled: true, expiresAt: null }]])
    return Effect.gen(function* () {
      const principal = yield* authenticateChatRequest(chatRequest(yield* signChatTestToken()))
      assert.deepStrictEqual(principal, {
        organization: { id: ORGANIZATION_ID },
        tenantUser: defaultTenantUser,
      })
      // The double has no update, so any write to the API-key usage columns would throw.
      assert.strictEqual(recorded.selects, 2)
      const join = chatAuthSql(recorded.joins[0])
      const [lookup, lifecycle] = recorded.wheres.map(chatAuthSql)
      assert.include(join.sql, '"api_key"."organization_id" = "organization"."id"')
      assert.include(join.sql, '"api_key"."id" = $1')
      assert.include(join.sql, '"api_key"."config_id" = $2')
      assert.deepStrictEqual(join.params, [KEY_ID, "default"])
      assert.include(lookup?.sql, '"organization"."id" = $1')
      assert.deepStrictEqual(lookup?.params, [ORGANIZATION_ID])
      assert.include(lifecycle?.sql, '"api_key"."id" = $1')
      assert.include(lifecycle?.sql, '"api_key"."organization_id" = $2')
      assert.deepStrictEqual(lifecycle?.params, [KEY_ID, ORGANIZATION_ID])
    }).pipe(Effect.provide(layer))
  })

  for (const [name, current] of [
    ["missing", undefined],
    ["disabled", { enabled: false, expiresAt: null }],
    ["expired", { enabled: true, expiresAt: new Date(0) }],
  ] as const) {
    it.effect(`rejects a ${name} API key during the lifecycle reread`, () =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          authenticateChatRequest(chatRequest(yield* signChatTestToken())),
        )
        assert.strictEqual(failure._tag, "ChatAuthenticationError")
      }).pipe(Effect.provide(recordingDatabase([[keyRow], current ? [current] : []]).layer)),
    )
  }

  it.effect("does not require or interpret the optional JWT subject", () =>
    Effect.gen(function* () {
      const subjectToken = yield* signChatTestToken({ subject: "host-defined-subject" })
      assert.deepStrictEqual(yield* verifyWithStoredKey(subjectToken), defaultTenantUser)
    }),
  )

  it.effect("accepts deeply nested metadata", () =>
    Effect.gen(function* () {
      const nested = yield* verifyWithStoredKey(
        yield* signChatTestToken({ user: deeplyNestedUser }),
      )
      assert.deepStrictEqual(nested, {
        ...(deeplyNestedUser as object),
        tenant: defaultTenant,
      } as never)
    }),
  )

  for (const [name, overrides] of [
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
    ["user fields outside metadata", { user: { ...defaultUser, role: "admin" } }],
    ["tenant fields outside metadata", { tenant: { ...defaultTenant, plan: "enterprise" } }],
    ["legacy nested tenant user", { claims: { tenantUser: defaultTenantUser } }],
  ] satisfies [string, ChatTestTokenOverrides][]) {
    it.effect(`rejects ${name}`, () =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(verifyWithStoredKey(yield* signChatTestToken(overrides)))
        assert.strictEqual(failure._tag, "ChatAuthenticationError")
      }),
    )
  }

  it.effect("rejects legacy key IDs and malformed tokens before querying", () => {
    const { recorded, layer } = recordingDatabase([])
    return Effect.gen(function* () {
      const legacy = yield* signChatTestToken({ apiKeyId: "key_acme_production" })
      assert.strictEqual(
        (yield* Effect.flip(authenticateChatRequest(chatRequest(legacy))))._tag,
        "ChatAuthenticationError",
      )
      assert.strictEqual(
        (yield* Effect.flip(authenticateChatRequest(chatRequest("not-a-jwt"))))._tag,
        "ChatAuthenticationError",
      )
      assert.strictEqual(recorded.selects, 0)
      assert.strictEqual(
        (yield* Effect.flip(verifyWithStoredKey("not-a-jwt")))._tag,
        "ChatAuthenticationError",
      )
    }).pipe(Effect.provide(layer))
  })
})
