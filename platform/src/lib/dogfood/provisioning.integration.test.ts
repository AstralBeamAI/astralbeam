import process from "node:process"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { fromCrossJSON, type SerovalNode, toJSON } from "seroval"
import { and, eq, sql } from "drizzle-orm"
import { defaultKeyHasher } from "@better-auth/api-key"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import { beforeEach, describe, expect, test, vi } from "vitest"

import type { Mailer } from "@/lib/email/email.server"

type MailerService = Mailer["Service"]

const dogfoodIntegration = vi.hoisted(() => {
  // Vite supplies this parseable value only so database modules can load when the suite is skipped.
  const configuredUrl = globalThis.process.env.DATABASE_URL
  const url =
    configuredUrl === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configuredUrl
  if (url) {
    const parsed = new URL(url)
    if (
      parsed.hostname !== "127.0.0.1" ||
      !(parsed.pathname.endsWith("_test") || parsed.pathname.endsWith("_e2e"))
    ) {
      throw new Error("Use a disposable loopback database ending in _test or _e2e")
    }
  }
  return {
    url,
    resetUrl: "",
    failEmail: false,
    sendResetPassword: vi.fn<(data: { user: { email: string }; url: string }) => void>(),
  }
})

// Better Auth sends through the Mailer its service captured, so the app layer carries this double.
vi.mock("@/lib/email/email.server", async (original) => {
  const { EmailDeliveryError } = await import("@/lib/email/errors")
  const email = await original<typeof import("@/lib/email/email.server")>()
  const layer = Layer.succeed(email.Mailer, {
    sendResetPassword: (data) =>
      Effect.suspend(() => {
        dogfoodIntegration.sendResetPassword(data)
        if (dogfoodIntegration.failEmail)
          return Effect.fail(new EmailDeliveryError({ reason: "test" }))
        dogfoodIntegration.resetUrl = data.url
        return Effect.void
      }),
    sendAccountExists: () => Effect.void,
    sendOrganizationInvitation: () => Effect.void,
    sendPasswordChanged: () => Effect.void,
    sendVerification: () => Effect.void,
  } as Partial<MailerService> as MailerService)
  return { Mailer: Object.assign(email.Mailer, { layer }) }
})

import { getAuthDatabase } from "@/db/database"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter"
import { Dogfood } from "@/lib/dogfood/dogfood.server"
import {
  account,
  agent,
  agentModel,
  apiKey,
  member,
  modelProvider,
  organization,
  organizationConfiguration,
  providerModel,
  tenant,
  tenantUser,
  user,
} from "@/db/schema"
import { parseDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import { encryptDatabaseValue } from "@/db/lib/encryption"
import { ConfigValuePayloadSchema } from "@/db/schema/config"
import { Auth } from "@/lib/auth/auth.server"
import { Config } from "@/lib/config/config"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import type { ConfigValues } from "@/lib/config/types"
import { createOperatorSession } from "@/routes/configure/-lib/operator-session.server"
import { authenticateChatRequest } from "@/lib/chat/auth"
import { authenticateRestRequest } from "@/routes/api/v1/-lib/auth.server"
import type { ChatPrincipal } from "@/lib/chat/types"
import { TenantUsers } from "@/lib/tenants/tenant-users"
import { getCurrentUser } from "@/routes/api/v1/-lib/current-user-auth.server"
import { issueDashboardToken } from "@/lib/auth/dashboard-token.server"
import type { OwnerOnboarding } from "./schemas.ts"
import { seedModelProviders } from "../../../scripts/seed/models.ts"
import { SEED_CONFIG_VALUES, SEED_ORGANIZATIONS } from "../../../scripts/seed/fixtures.ts"

const ownerOnboardingFixture = {
  email: "provisioning-owner@example.com",
  organizationName: "dogfood",
  organizationSlug: "dogfood",
}
const ownerOnboardingPassword = "Owner-Onboarding-Test-Password-761"
const sendResetPasswordEmail = dogfoodIntegration.sendResetPassword

function getProvisioningAuth() {
  return runAppEffect(Effect.flatMap(Auth, (auth) => auth.instance))
}

async function synchronizeDashboardIdentity(organizationSlug: string, headers: Headers) {
  const { token } = await runAppEffect(issueDashboardToken({ organizationSlug, headers }))
  return runAppEffect(
    getCurrentUser(
      new Request("http://localhost/api/v1/me", {
        headers: { authorization: `Bearer ${token}` },
      }),
    ),
  )
}

function provisionDogfood(input: OwnerOnboarding = ownerOnboardingFixture) {
  return runAppEffect(
    Effect.flatMap(Dogfood, (dogfood) => dogfood.withProvisioningLock(dogfood.provision(input))),
  )
}

function getDatabaseConfig() {
  return runAppEffect(Effect.flatMap(Config, (config) => config.readStored))
}

function invalidateGlobalConfig() {
  return runAppEffect(Effect.flatMap(Config, (config) => config.invalidate))
}

function readDogfoodOnboarding(values: ConfigValues) {
  return Effect.flatMap(Dogfood, (dogfood) => dogfood.onboarding(values))
}

async function completeOwnerPassword(email = ownerOnboardingFixture.email) {
  const auth = await getProvisioningAuth()
  const token = new URL(dogfoodIntegration.resetUrl).pathname.split("/").at(-1)!
  await auth.api.resetPassword({ body: { token, newPassword: ownerOnboardingPassword } })
  const response = await auth.api.signInEmail({
    body: { email, password: ownerOnboardingPassword },
    asResponse: true,
  })
  expect(response.status).toBe(200)
  const cookie = response.headers
    .getSetCookie()
    .map((part) => part.split(";")[0])
    .join("; ")
  return new Headers({ cookie })
}

describe.skipIf(!dogfoodIntegration.url)(
  "owner provisioning with PostgreSQL and Better Auth",
  () => {
    let db: ReturnType<typeof getAuthDatabase>
    beforeEach(async () => {
      db = getAuthDatabase()
      // The URL guard runs before any database module is imported.
      await db.execute(sql`truncate "config", "organization", "user" cascade`)
      process.env.DATABASE_ENCRYPTION_KEY = "dogfood-integration-encryption-key-not-for-production"
      process.env.APP_BASE_URL = "http://localhost:4500"
      process.env.BETTER_AUTH_SECRET = "dogfood-integration-auth-key-not-for-production"
      process.env.OPENAI_API_KEY = "sk-development-provisioning-test-only"
      process.env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA"
      process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA"
      process.env.SUPPORT_EMAIL_ADDRESS = "support@example.com"
      for (const [key, value] of Object.entries(SEED_CONFIG_VALUES)) {
        if (key.startsWith("s3_")) process.env[key.toUpperCase()] = value
      }
      process.env.TERMS_OF_SERVICE_URL = "https://example.com/terms"
      dogfoodIntegration.failEmail = false
      dogfoodIntegration.resetUrl = ""
      vi.clearAllMocks()
      await invalidateGlobalConfig()
    })

    test("dogfood provisioning leaves model setup to its owner", async () => {
      await provisionDogfood()
      const organizationId = (await getDatabaseConfig()).values.dogfood_organization_id!
      const [configuration] = await db.select().from(organizationConfiguration)
      const [defaultAgent] = await db.select().from(agent)
      expect(configuration).toMatchObject({ organizationId })
      expect(defaultAgent).toMatchObject({ organizationId, id: configuration!.defaultAgentId })
      expect(await db.select().from(modelProvider)).toHaveLength(0)
    })

    test("development seeds assign models and preserve edited providers", async () => {
      await provisionDogfood()
      for (const fixture of SEED_ORGANIZATIONS) {
        await db
          .insert(organization)
          .values({ id: fixture.id, name: fixture.name, slug: fixture.slug })
        await db.insert(agent).values({
          organizationId: fixture.id,
          name: fixture.agents[0].name,
          systemPrompt: "Help with local tests",
        })
      }
      await db.transaction(seedModelProviders)
      const providers = await db.select().from(modelProvider)
      expect(providers).toHaveLength(SEED_ORGANIZATIONS.length + 1)
      expect(await db.select().from(agentModel)).toHaveLength(SEED_ORGANIZATIONS.length + 1)
      const dogfoodId = (await getDatabaseConfig()).values.dogfood_organization_id!
      const original = providers.find((provider) => provider.organizationId === dogfoodId)!
      await db
        .update(modelProvider)
        .set({
          name: "Owner's gateway",
          credentials: {
            organizationId: dogfoodId,
            modelProviderId: original.id,
            providerType: "openai",
            apiKey: "sk-owner-replaced-dogfood-model-key",
          },
        })
        .where(eq(modelProvider.organizationId, dogfoodId))
      await db.delete(agentModel).where(eq(agentModel.organizationId, dogfoodId))
      await db.delete(providerModel).where(eq(providerModel.organizationId, dogfoodId))
      await db.transaction(seedModelProviders)
      expect(await db.select().from(modelProvider)).toHaveLength(providers.length)
      const [preserved] = await db
        .select()
        .from(modelProvider)
        .where(eq(modelProvider.organizationId, dogfoodId))
      expect(preserved).toMatchObject({
        id: original.id,
        name: "Owner's gateway",
        credentials: { apiKey: "sk-owner-replaced-dogfood-model-key" },
      })
      expect(
        await db.select().from(providerModel).where(eq(providerModel.organizationId, dogfoodId)),
      ).toHaveLength(0)
      expect(
        await db.select().from(agentModel).where(eq(agentModel.organizationId, dogfoodId)),
      ).toHaveLength(0)
    })

    test("two tab selectors and concurrent JIT upserts preserve tenant isolation and ordinary JWT privileges", async () => {
      await provisionDogfood()
      await expect(
        runAppEffect(
          issueDashboardToken({
            organizationSlug: "dogfood",
            headers: new Headers(),
          }),
        ),
      ).rejects.toMatchObject({ _tag: "SignInRequired" })
      expect(await db.select().from(tenant)).toHaveLength(0)
      const headers = await completeOwnerPassword()
      const auth = await getProvisioningAuth()
      const session = await auth.api.getSession({ headers })
      const second = await auth.api.createOrganization({
        body: { userId: session!.user.id, name: "Second", slug: "second" },
      })
      await auth.api.setActiveOrganization({ headers, body: { organizationId: second.id } })
      const issued = await Promise.all(
        Array.from({ length: 5 }, () =>
          runAppEffect(issueDashboardToken({ organizationSlug: "dogfood", headers })),
        ),
      )
      const request = new Request("http://localhost:4500/api/v1/chat", {
        headers: { authorization: `Bearer ${issued[0]!.token}` },
      })
      expect(await db.select().from(tenant)).toHaveLength(0)
      await Promise.all(
        issued.map(({ token }) =>
          runAppEffect(
            getCurrentUser(
              new Request("http://localhost/api/v1/me", {
                headers: { authorization: `Bearer ${token}` },
              }),
            ),
          ),
        ),
      )
      const principal = await runAppEffect(authenticateChatRequest(request))
      const dogfoodId = (await getDatabaseConfig()).values.dogfood_organization_id!
      expect(principal.organization.id).toBe(dogfoodId)
      expect(principal.tenantUser).toMatchObject({
        id: session!.user.id,
        admin: false,
        tenant: { id: dogfoodId },
      })
      await expect(runAppEffect(authenticateRestRequest(request))).rejects.toMatchObject({
        _tag: "RestTenantAdminRequired",
      })
      expect(await db.select().from(tenant)).toHaveLength(1)
      expect(await db.select().from(tenantUser)).toHaveLength(1)
      const [firstUser] = await db.select().from(tenantUser)
      await db.update(tenantUser).set({ admin: true }).where(eq(tenantUser.id, firstUser!.id))
      await synchronizeDashboardIdentity("dogfood", headers)
      expect((await db.select().from(tenantUser))[0]).toMatchObject({
        id: firstUser!.id,
        admin: false,
      })
      await synchronizeDashboardIdentity("second", headers)
      expect(await db.select().from(tenantUser)).toHaveLength(2)
      await db.update(organization).set({ slug: "renamed" }).where(eq(organization.id, dogfoodId))
      await synchronizeDashboardIdentity("renamed", headers)
      expect(await db.select().from(tenant)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ externalId: dogfoodId, metadata: { slug: "renamed" } }),
          expect.objectContaining({ externalId: second.id, metadata: { slug: "second" } }),
        ]),
      )
      await db
        .delete(member)
        .where(and(eq(member.organizationId, second.id), eq(member.userId, session!.user.id)))
      await expect(
        runAppEffect(issueDashboardToken({ organizationSlug: "second", headers })),
      ).rejects.toMatchObject({ _tag: "OrganizationNotFound" })
      expect(await db.select().from(tenantUser)).toHaveLength(2)
      await runAppEffect(
        Effect.flatMap(DatabaseRateLimiter, (limiter) =>
          limiter.consume({
            key: `dashboard-token:${session!.user.id}`,
            limit: 60,
            window: "1 minute",
          }),
        ).pipe(Effect.ignore, Effect.repeat({ times: 59 })),
      )
      await expect(
        runAppEffect(issueDashboardToken({ organizationSlug: "renamed", headers })),
      ).rejects.toMatchObject({ _tag: "DashboardTokenRateLimited" })
    })

    test("tenant synchronization preserves identity, replaces supplied fields, isolates scope and rolls back", async () => {
      const [first, second] = await db
        .insert(organization)
        .values([
          { name: "First", slug: "first" },
          { name: "Second", slug: "second" },
        ])
        .returning()
      const principal = {
        organization: { id: first!.id },
        tenantUser: {
          id: "same-user",
          name: "Original",
          admin: true,
          metadata: { first: true },
          tenant: { id: "same-tenant", name: "Original tenant", metadata: { first: true } },
        },
      }
      const synchronize = (principal: ChatPrincipal) =>
        runAppEffect(
          Effect.flatMap(TenantUsers, (tenantUsers) => tenantUsers.syncCurrentUser({ principal })),
        )
      const original = await synchronize(principal)
      const minimal = await synchronize({
        organization: principal.organization,
        tenantUser: { id: "same-user", tenant: { id: "same-tenant" } },
      })
      expect(minimal.tenant).toMatchObject({
        id: original.tenant.id,
        name: "Original tenant",
        metadata: { first: true },
        createdAt: original.tenant.createdAt,
      })
      expect(minimal.user).toMatchObject({
        id: original.user.id,
        name: "Original",
        metadata: { first: true },
        admin: true,
        createdAt: original.user.createdAt,
      })
      const changed = await synchronize({
        ...principal,
        tenantUser: {
          ...principal.tenantUser,
          name: "Changed",
          metadata: {},
          admin: false,
          tenant: { ...principal.tenantUser.tenant, metadata: { next: true } },
        },
      })
      expect(changed.user).toMatchObject({
        id: original.user.id,
        name: "Changed",
        metadata: {},
        admin: false,
      })
      expect(changed.tenant.metadata).toEqual({ next: true })
      const newUser = await synchronize({
        organization: principal.organization,
        tenantUser: { id: "new-user", tenant: { id: "same-tenant" } },
      })
      expect(newUser.user.admin).toBe(false)
      const otherTenant = await synchronize({
        ...principal,
        tenantUser: { ...principal.tenantUser, tenant: { id: "other-tenant" } },
      })
      const otherOrganization = await synchronize({
        ...principal,
        organization: { id: second!.id },
      })
      expect(new Set([original.user.id, otherTenant.user.id, otherOrganization.user.id]).size).toBe(
        3,
      )
      await db.execute(
        sql`alter table tenant_user add constraint synchronization_rollback_test check (external_id <> 'rollback-user')`,
      )
      try {
        await expect(
          synchronize({
            ...principal,
            tenantUser: { id: "rollback-user", tenant: { id: "rollback-tenant" } },
          }),
        ).rejects.toBeDefined()
        expect(
          await db.select().from(tenant).where(eq(tenant.externalId, "rollback-tenant")),
        ).toHaveLength(0)
      } finally {
        await db.execute(sql`alter table tenant_user drop constraint synchronization_rollback_test`)
      }
    })

    test("directory tokens use the selected organization's key and current member permissions", async () => {
      await provisionDogfood()
      const headers = await completeOwnerPassword()
      const auth = await getProvisioningAuth()
      const session = await auth.api.getSession({ headers })
      const second = await auth.api.createOrganization({
        body: { userId: session!.user.id, name: "Directory", slug: "directory" },
      })
      const input = { organizationSlug: "directory", scope: "organization" as const, headers }
      await expect(runAppEffect(issueDashboardToken(input))).rejects.toMatchObject({
        _tag: "OrganizationApiKeysMissing",
      })
      const disabled = await auth.api.createApiKey({
        headers,
        body: { organizationId: second.id, name: "Disabled" },
      })
      await db.update(apiKey).set({ enabled: false }).where(eq(apiKey.id, disabled.id))
      await expect(runAppEffect(issueDashboardToken(input))).rejects.toMatchObject({
        _tag: "OrganizationApiKeyUnavailable",
      })
      const active = await auth.api.createApiKey({
        headers,
        body: { organizationId: second.id, name: "Active" },
      })
      await auth.api.deleteApiKey({ headers, body: { keyId: disabled.id } })
      await expect(
        auth.api.deleteApiKey({ headers, body: { keyId: active.id } }),
      ).rejects.toMatchObject({ body: { code: "LAST_API_KEY" } })
      await db
        .update(member)
        .set({ role: "viewer" })
        .where(and(eq(member.organizationId, second.id), eq(member.userId, session!.user.id)))
      const { token } = await runAppEffect(issueDashboardToken(input))
      const authorization = { authorization: `Bearer ${token}` }
      const scope = await runAppEffect(
        authenticateRestRequest(
          new Request("http://localhost:4500/api/v1/tenants", { headers: authorization }),
        ),
      )
      expect(scope).toMatchObject({
        organizationId: second.id,
        currentUser: { id: session!.user.id, role: "viewer" },
      })
      await expect(
        runAppEffect(
          authenticateRestRequest(
            new Request("http://localhost:4500/api/v1/tenants", {
              method: "POST",
              headers: authorization,
            }),
          ),
        ),
      ).rejects.toMatchObject({ _tag: "RestRoleForbidden" })
      expect(await db.select().from(tenant)).toHaveLength(0)
      await db
        .update(apiKey)
        .set({ expiresAt: new Date(0) })
        .where(eq(apiKey.id, active.id))
      await expect(runAppEffect(issueDashboardToken(input))).rejects.toMatchObject({
        _tag: "OrganizationApiKeyUnavailable",
      })
      await expect(
        runAppEffect(
          authenticateRestRequest(
            new Request("http://localhost:4500/api/v1/tenants", { headers: authorization }),
          ),
        ),
      ).rejects.toMatchObject({ _tag: "RestInvalidCredentials" })
      await db.delete(member).where(eq(member.organizationId, second.id))
      await expect(runAppEffect(issueDashboardToken(input))).rejects.toMatchObject({
        _tag: "OrganizationNotFound",
      })
    })

    test("concurrent deletions cannot remove an organization's last API key", async () => {
      await provisionDogfood()
      const headers = await completeOwnerPassword()
      const auth = await getProvisioningAuth()
      const session = await auth.api.getSession({ headers })
      const second = await auth.api.createOrganization({
        body: { userId: session!.user.id, name: "Racing", slug: "racing" },
      })
      const keys = await Promise.all(
        ["First", "Second"].map((name) =>
          auth.api.createApiKey({ headers, body: { organizationId: second.id, name } }),
        ),
      )
      const deletions = await Promise.allSettled(
        keys.map((key) => auth.api.deleteApiKey({ headers, body: { keyId: key.id } })),
      )
      expect(deletions.filter((result) => result.status === "fulfilled")).toHaveLength(1)
      expect(deletions.find((result) => result.status === "rejected")).toMatchObject({
        reason: { body: { code: "LAST_API_KEY" } },
      })
      expect(
        await db.select({ id: apiKey.id }).from(apiKey).where(eq(apiKey.organizationId, second.id)),
      ).toHaveLength(1)
    })

    test("the configured chat key cannot be deleted, regardless of its name", async () => {
      await provisionDogfood()
      const headers = await completeOwnerPassword()
      const auth = await getProvisioningAuth()
      const [protectedKey] = await db.select().from(apiKey)
      await expect(
        auth.api.deleteApiKey({ body: { keyId: protectedKey!.id } }),
      ).rejects.toMatchObject({ statusCode: 401 })
      await db.update(member).set({ role: "viewer" })
      await expect(
        auth.api.deleteApiKey({ headers, body: { keyId: protectedKey!.id } }),
      ).rejects.toMatchObject({ body: { code: "INSUFFICIENT_API_KEY_PERMISSIONS" } })
      await db.update(member).set({ role: "owner" })
      const unrelated = await auth.api.createApiKey({
        headers,
        body: { organizationId: protectedKey!.organizationId, name: "dogfood" },
      })
      await auth.api.updateApiKey({
        headers,
        body: { keyId: protectedKey!.id, name: "Renamed" },
      })
      const response = await auth.handler(
        new Request("http://localhost:4500/api/auth/api-key/delete", {
          method: "POST",
          headers: {
            ...Object.fromEntries(headers),
            "content-type": "application/json",
            origin: "http://localhost:4500",
          },
          body: JSON.stringify({ keyId: protectedKey!.id }),
        }),
      )
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: "DOGFOOD_API_KEY_IN_USE" })
      await auth.api.deleteApiKey({ headers, body: { keyId: unrelated.id } })
      expect(await db.select({ id: apiKey.id }).from(apiKey)).toEqual([{ id: protectedKey!.id }])
    })

    test("incomplete authentication cannot finalize ownership", async () => {
      delete process.env.TURNSTILE_SITE_KEY
      await invalidateGlobalConfig()
      await expect(provisionDogfood()).rejects.toMatchObject({ _tag: "OwnerOnboardingFailed" })
      expect((await getDatabaseConfig()).values.dogfood_organization_id).toBeUndefined()
      expect(await db.select().from(user)).toHaveLength(0)
      expect(sendResetPasswordEmail).not.toHaveBeenCalled()
    })

    test("failed delivery retains provenance and retry reuses resources", async () => {
      dogfoodIntegration.failEmail = true
      await expect(provisionDogfood()).rejects.toMatchObject({ _tag: "OwnerOnboardingFailed" })
      expect((await getDatabaseConfig()).values.dogfood_organization_id).toBeUndefined()
      const [created] = await db.select().from(user)
      expect(created).toMatchObject({ emailVerified: true, termsAcceptedAt: null })
      expect(await db.select().from(account)).toHaveLength(0)
      const keys = await db.select().from(apiKey)
      expect(keys).toHaveLength(1)
      expect(await db.select().from(agent)).toHaveLength(1)
      await db.update(organization).set({ name: "Renamed dogfood", slug: "renamed-dogfood" })
      expect(
        await runAppEffect(readDogfoodOnboarding((await getDatabaseConfig()).values)),
      ).toMatchObject({ organizationCreated: true, complete: false })
      dogfoodIntegration.failEmail = false
      await provisionDogfood()
      expect(sendResetPasswordEmail).toHaveBeenCalledTimes(2)
      expect(await db.select().from(user)).toHaveLength(1)
      expect(await db.select().from(apiKey)).toEqual(keys)
      expect(await db.select().from(agent)).toHaveLength(1)
      const { values } = await getDatabaseConfig()
      expect(values.dogfood_pending_setup).toBeUndefined()
      expect(await runAppEffect(readDogfoodOnboarding(values))).toMatchObject({
        email: ownerOnboardingFixture.email,
        organizationName: "Renamed dogfood",
        organizationSlug: "renamed-dogfood",
        complete: true,
      })
      const prefix = `key_${keys[0]!.organizationId}_${keys[0]!.id}_`
      expect(values.dogfood_api_key).toMatch(new RegExp(`^${prefix}abo_[A-Za-z]{64}$`))
      expect(await defaultKeyHasher(values.dogfood_api_key!.slice(prefix.length))).toBe(
        keys[0]!.key,
      )
    })

    test.each([false, true])(
      "an existing account (verified: %s) is rejected without changing it or trapping setup",
      async (emailVerified) => {
        await db
          .insert(user)
          .values({ email: ownerOnboardingFixture.email, name: "Existing owner", emailVerified })
        await expect(provisionDogfood()).rejects.toMatchObject({ _tag: "OwnerOnboardingFailed" })
        expect((await db.select().from(user))[0]?.emailVerified).toBe(emailVerified)
        expect(await db.select().from(organization)).toHaveLength(0)
        expect((await getDatabaseConfig()).values.dogfood_pending_setup).toBeUndefined()
        expect(sendResetPasswordEmail).not.toHaveBeenCalled()
        await provisionDogfood({ ...ownerOnboardingFixture, email: "different-owner@example.com" })
        expect(await db.select().from(organization)).toHaveLength(1)
      },
    )

    test("correcting a pending email removes only the old membership and keeps email required", async () => {
      dogfoodIntegration.failEmail = true
      await expect(provisionDogfood()).rejects.toMatchObject({ _tag: "OwnerOnboardingFailed" })
      const organizations = await db.select().from(organization)
      const agents = await db.select().from(agent)
      const [previous] = await db.select().from(user)
      const auth = await getProvisioningAuth()
      const unrelated = await auth.api.createOrganization({
        body: { userId: previous!.id, name: "Unrelated", slug: "unrelated" },
      })
      const corrected = { ...ownerOnboardingFixture, email: "corrected-owner@example.com" }
      await db.insert(user).values({
        email: corrected.email,
        name: "Existing",
        emailVerified: true,
      })
      await expect(provisionDogfood(corrected)).rejects.toMatchObject({
        _tag: "OwnerOnboardingFailed",
      })
      expect(await db.select().from(member)).toHaveLength(2)
      await db.execute(sql`delete from "user" where email = ${corrected.email}`)
      await expect(provisionDogfood(corrected)).rejects.toMatchObject({
        _tag: "OwnerOnboardingFailed",
      })
      const pending = await getDatabaseConfig()
      expect(pending.values.dogfood_organization_id).toBeUndefined()
      expect(JSON.parse(pending.values.dogfood_pending_setup!)).toMatchObject({
        email: corrected.email,
        organizationId: organizations[0]!.id,
      })
      const memberships = await db.select().from(member)
      expect(memberships.filter((row) => row.userId === previous!.id)).toMatchObject([
        { organizationId: unrelated.id, role: "owner" },
      ])
      dogfoodIntegration.failEmail = false
      await provisionDogfood(corrected)
      expect(
        (await db.select().from(organization)).filter((row) => row.id !== unrelated.id),
      ).toEqual(organizations)
      expect(
        (await db.select().from(agent)).filter((row) => row.organizationId !== unrelated.id),
      ).toEqual(agents)
      expect(vi.mocked(sendResetPasswordEmail).mock.lastCall?.[0].user.email).toBe(corrected.email)
      await completeOwnerPassword(corrected.email)
    })

    test("concurrent provisioning invites one new owner", async () => {
      const concurrent = await Promise.allSettled(
        Array.from({ length: 3 }, () => provisionDogfood()),
      )
      expect(concurrent.some((result) => result.status === "fulfilled")).toBe(true)
      await provisionDogfood()
      expect(sendResetPasswordEmail).toHaveBeenCalledTimes(1)
      expect(await db.select().from(organization)).toHaveLength(1)
      expect(await db.select().from(user)).toHaveLength(1)
    })

    test("an unrelated slug is rejected without taking ownership or trapping setup", async () => {
      const auth = await getProvisioningAuth()
      const [other] = await db
        .insert(user)
        .values({ email: "other@example.com", name: "Other" })
        .returning()
      await auth.api.createOrganization({
        body: { userId: other!.id, name: "Existing", slug: "dogfood" },
      })
      await expect(provisionDogfood()).rejects.toMatchObject({ _tag: "OwnerOnboardingFailed" })
      expect((await getDatabaseConfig()).values.dogfood_pending_setup).toBeUndefined()
      expect(await db.select().from(user)).toHaveLength(1)
      await provisionDogfood({ ...ownerOnboardingFixture, organizationSlug: "newdogfood" })
      expect(await db.select().from(organization)).toHaveLength(2)
    })

    test("configuration requires only operator credentials, including during repair", async () => {
      await provisionDogfood()
      const ownerHeaders = await completeOwnerPassword()
      const operator = await runAppEffect(createOperatorSession())
      const authorizedCookie = `operator_session=${operator}`
      const fallbackKey = "retired-dogfood-test-encryption-key"
      const listener = createServer()
      await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve))
      const address = listener.address()
      if (!address || typeof address === "string") throw new Error("Missing test port")
      const port = address.port
      await new Promise<void>((resolve) => listener.close(() => resolve()))
      const origin = `http://localhost:${port}`
      const server = spawn(
        process.execPath,
        ["task", "dev", "--port", String(port), "--strictPort"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: dogfoodIntegration.url!,
            DATABASE_ENCRYPTION_KEY: `${process.env.DATABASE_ENCRYPTION_KEY},${fallbackKey}`,
            APP_BASE_URL: origin,
            GITHUB_CLIENT_ID: "incomplete-provider",
            GITHUB_CLIENT_SECRET: "",
            NODE_ENV: "development",
          },
          stdio: "ignore",
        },
      )
      try {
        await vi.waitFor(
          async () => {
            expect(
              (await fetch(`${origin}/src/routes/configure/-functions/save-config-values.ts`)).ok,
            ).toBe(true)
          },
          { timeout: 30_000, interval: 250 },
        )
        const cases = [
          ["save-config-values", { updates: [] }],
          ["generate-config-value", { key: "dogfood_api_key" }],
          ["reveal-config-value", { key: "dogfood_api_key" }],
          ["apply-migrations", { approvedMigrations: [] }],
          [
            "test-email-provider-connection",
            {
              provider: "smtp",
              settings: { host: "127.0.0.1", port: 1025, security: "none" },
            },
          ],
        ] as const
        const requests = new Map<string, (cookie: string, input?: unknown) => Promise<Response>>()
        for (const [name, data] of cases) {
          const module = await (
            await fetch(`${origin}/src/routes/configure/-functions/${name}.ts`)
          ).text()
          const id = /createClientRpc\("([^"]+)"\)/.exec(module)?.[1]
          if (!id) throw new Error(`Missing compiled RPC for ${name}`)
          const request = (cookie: string, input: unknown = data) =>
            fetch(`${origin}/_serverFn/${id}`, {
              method: "POST",
              headers: {
                cookie,
                origin,
                "sec-fetch-site": "same-origin",
                "content-type": "application/json",
                "x-tsr-serverFn": "true",
              },
              body: JSON.stringify(toJSON({ data: input })),
            })
          requests.set(name, request)
          for (const cookie of ["", ownerHeaders.get("cookie")!]) {
            const response = await request(cookie)
            await response.text()
            expect(response.status).toBe(403)
          }
        }
        const dogfoodCredential = (await getDatabaseConfig()).values.dogfood_api_key!
        for (const name of ["reveal-config-value", "generate-config-value"]) {
          const response = await requests.get(name)!(authorizedCookie)
          expect(response.status).toBe(422)
          expect(await response.text()).not.toContain(dogfoodCredential)
        }
        const before = (await getDatabaseConfig()).values.privacy_policy_url
        const acquired = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const lock = runAppEffect(
          Effect.flatMap(Dogfood, (dogfood) =>
            dogfood.withProvisioningLock(
              Effect.promise(() => {
                acquired.resolve()
                return release.promise
              }),
            ),
          ),
        )
        try {
          await acquired.promise
          const response = await requests.get("save-config-values")!(authorizedCookie, {
            updates: [{ key: "privacy_policy_url", value: "https://example.com/blocked" }],
          })
          expect(response.status).toBe(409)
          await response.text()
          expect((await getDatabaseConfig()).values.privacy_policy_url).toBe(before)
        } finally {
          release.resolve()
          await lock
        }
        const configured = (await getDatabaseConfig()).values
        for (const key of ["dogfood_organization_id", "dogfood_api_key"] as const) {
          const encrypted = Result.getOrThrow(
            encryptDatabaseValue({
              value: { key, value: configured[key]! },
              schema: ConfigValuePayloadSchema,
              keyring: parseDatabaseEncryptionKeyring(fallbackKey),
            }),
          )
          await db.execute(sql`update config set value = ${encrypted} where key = ${key}`)
        }
        const response = await requests.get("save-config-values")!(authorizedCookie)
        const result = fromCrossJSON<{ result: unknown }>(
          (await response.json()) as SerovalNode,
          {},
        )
        expect(result.result).toEqual({ fieldErrors: [] })
        // This process only has the active key, so a read proves the fallback can be retired.
        expect((await getDatabaseConfig()).values).toEqual(configured)
      } finally {
        server.kill("SIGTERM")
        await new Promise<void>((resolve) => {
          if (server.exitCode !== null || server.signalCode !== null) resolve()
          else server.once("exit", () => resolve())
        })
      }
    }, 60_000)
  },
)
