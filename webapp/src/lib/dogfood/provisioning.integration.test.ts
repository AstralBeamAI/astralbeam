import process from "node:process"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { fromCrossJSON, type SerovalNode, toJSON } from "seroval"
import { sql } from "drizzle-orm"
import { defaultKeyHasher } from "@better-auth/api-key"
import * as Effect from "effect/Effect"
import { beforeEach, describe, expect, test, vi } from "vitest"

const dogfoodIntegration = vi.hoisted(() => {
  // Vite supplies this parseable value only so database modules can load when the suite is skipped.
  const configuredUrl = globalThis.process.env.DATABASE_URL
  const url = configuredUrl === "postgres://test:test@127.0.0.1:5432/test"
    ? undefined
    : configuredUrl
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
    request: null as Request | null,
    resetUrl: "",
    failEmail: false,
  }
})

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (!dogfoodIntegration.request) throw new Error("No request")
    return dogfoodIntegration.request
  },
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
}))
vi.mock("@/emails/index", () => ({
  sendResetPasswordEmail: vi.fn(({ url }: { url: string }) => {
    if (dogfoodIntegration.failEmail) throw new Error("provider-private-failure")
    dogfoodIntegration.resetUrl = url
    return Promise.resolve()
  }),
  sendAccountExistsEmail: vi.fn(),
  sendOrganizationInvitationEmail: vi.fn(),
  sendPasswordChangedEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn(),
}))

import { db, runDatabaseEffect } from "@/db"
import { getDatabaseConfig } from "@/db/config.server"
import { withDogfoodProvisioningLock } from "@/db/dogfood.server"
import {
  account,
  agent,
  apiKey,
  member,
  organization,
  organizationConfiguration,
  user,
} from "@/db/schema.server"
import { parseDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"
import { encryptDatabaseValue } from "@/db/lib/encryption.server"
import { decodeConfigValuePayload } from "@/db/schema/config.server"
import { getAuth } from "@/lib/auth.server"
import { provisionOrganizationDefaultAgent } from "@/db/agent.server"
import { sendResetPasswordEmail } from "@/emails/index"
import { invalidateGlobalConfig } from "@/lib/config/runtime.server"
import { createOperatorSession } from "@/routes/configure/-lib/operator-session.server"
import { provisionDogfoodResources } from "./provisioning.server"

const ownerOnboardingFixture = {
  email: "provisioning-owner@example.com",
  organizationName: "dogfood",
  organizationSlug: "dogfood",
}
const ownerOnboardingPassword = "Owner-Onboarding-Test-Password-761"

function provisionDogfood(input = ownerOnboardingFixture) {
  return runDatabaseEffect(withDogfoodProvisioningLock(provisionDogfoodResources(input)))
}

async function completeOwnerPassword(email = ownerOnboardingFixture.email) {
  const auth = await getAuth()
  const token = new URL(dogfoodIntegration.resetUrl).pathname.split("/").at(-1)!
  await auth.api.resetPassword({ body: { token, newPassword: ownerOnboardingPassword } })
  const response = await auth.api.signInEmail({
    body: { email, password: ownerOnboardingPassword },
    asResponse: true,
  })
  expect(response.status).toBe(200)
  const cookie = response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ")
  return new Headers({ cookie })
}

describe.skipIf(!dogfoodIntegration.url)(
  "owner provisioning with PostgreSQL and Better Auth",
  () => {
    beforeEach(async () => {
      // The URL guard runs before any database module is imported.
      await db.execute(sql`truncate "config", "organization", "user" cascade`)
      process.env.DATABASE_ENCRYPTION_KEY = "dogfood-integration-encryption-key-not-for-production"
      process.env.APP_BASE_URL = "http://localhost:4500"
      process.env.BETTER_AUTH_SECRET = "dogfood-integration-auth-key-not-for-production"
      process.env.OPENAI_API_KEY = "sk-development-provisioning-test-only"
      process.env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA"
      process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA"
      process.env.TERMS_OF_SERVICE_URL = "https://example.com/terms"
      dogfoodIntegration.request = new Request("http://localhost:4500/configure")
      dogfoodIntegration.failEmail = false
      dogfoodIntegration.resetUrl = ""
      vi.clearAllMocks()
      invalidateGlobalConfig()
    })

    test("local organization creation copies the model key without overwriting settings on retry", async () => {
      await provisionDogfood()
      const organizationId = (await getDatabaseConfig()).values.dogfood_organization_id!
      expect((await db.select().from(organizationConfiguration))[0]?.openaiApiKey).toEqual({
        organizationId,
        apiKey: "sk-development-provisioning-test-only",
      })
      await runDatabaseEffect(provisionOrganizationDefaultAgent({
        organizationId,
        organizationName: "dogfood",
        openaiApiKey: "sk-different-development-test-key",
      }))
      expect((await db.select().from(organizationConfiguration))[0]?.openaiApiKey?.apiKey)
        .toBe("sk-development-provisioning-test-only")
    })

    test("incomplete authentication cannot finalize ownership", async () => {
      delete process.env.TURNSTILE_SITE_KEY
      invalidateGlobalConfig()
      await expect(provisionDogfood()).rejects
        .toMatchObject({ _tag: "OwnerOnboardingError" })
      expect((await getDatabaseConfig()).values.dogfood_organization_id).toBeUndefined()
      expect(await db.select().from(user)).toHaveLength(0)
      expect(sendResetPasswordEmail).not.toHaveBeenCalled()
    })

    test("failed delivery retains provenance and retry reuses resources before a real password reset", async () => {
      dogfoodIntegration.failEmail = true
      await expect(provisionDogfood()).rejects.toMatchObject({ _tag: "OwnerOnboardingError" })
      expect((await getDatabaseConfig()).values.dogfood_organization_id).toBeUndefined()
      const [created] = await db.select().from(user)
      expect(created).toMatchObject({ emailVerified: true, termsAcceptedAt: null })
      expect(await db.select().from(account)).toHaveLength(0)
      const keys = await db.select().from(apiKey)
      expect(keys).toHaveLength(1)
      expect(await db.select().from(agent)).toHaveLength(1)
      dogfoodIntegration.failEmail = false
      await provisionDogfood()
      expect(sendResetPasswordEmail).toHaveBeenCalledTimes(2)
      expect(await db.select().from(user)).toHaveLength(1)
      expect(await db.select().from(apiKey)).toEqual(keys)
      expect(await db.select().from(agent)).toHaveLength(1)
      const { values } = await getDatabaseConfig()
      expect(values.dogfood_pending_setup).toBeUndefined()
      const prefix = `key_${keys[0]!.organizationId}_${keys[0]!.id}_`
      expect(values.dogfood_api_key).toMatch(new RegExp(`^${prefix}abo_[A-Za-z]{64}$`))
      expect(await defaultKeyHasher(values.dogfood_api_key!.slice(prefix.length))).toBe(
        keys[0]!.key,
      )
      await completeOwnerPassword()
    })

    test("an unverified account is rejected without changing it or trapping setup", async () => {
      await db.insert(user).values({ email: ownerOnboardingFixture.email, name: "Existing owner" })
      await expect(provisionDogfood()).rejects.toMatchObject({ _tag: "OwnerOnboardingError" })
      expect((await db.select().from(user))[0]?.emailVerified).toBe(false)
      expect(await db.select().from(organization)).toHaveLength(0)
      expect((await getDatabaseConfig()).values.dogfood_pending_setup).toBeUndefined()
      expect(sendResetPasswordEmail).not.toHaveBeenCalled()
      await provisionDogfood({ ...ownerOnboardingFixture, email: "different-owner@example.com" })
      expect(await db.select().from(organization)).toHaveLength(1)
    })

    test("correcting a pending email removes only the old membership and keeps email required", async () => {
      dogfoodIntegration.failEmail = true
      await expect(provisionDogfood()).rejects.toMatchObject({ _tag: "OwnerOnboardingError" })
      const organizations = await db.select().from(organization)
      const agents = await db.select().from(agent)
      const [previous] = await db.select().from(user)
      const auth = await getAuth()
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
        _tag: "OwnerOnboardingError",
      })
      expect(await db.select().from(member)).toHaveLength(2)
      await db.execute(sql`delete from "user" where email = ${corrected.email}`)
      await expect(provisionDogfood(corrected)).rejects.toMatchObject({
        _tag: "OwnerOnboardingError",
      })
      const pending = await getDatabaseConfig()
      expect(pending.values.dogfood_organization_id).toBeUndefined()
      expect(JSON.parse(pending.values.dogfood_pending_setup!)).toMatchObject({
        email: corrected.email,
        requiresResetEmail: true,
        organizationId: organizations[0]!.id,
      })
      const memberships = await db.select().from(member)
      expect(memberships.filter((row) => row.userId === previous!.id)).toMatchObject([
        { organizationId: unrelated.id, role: "owner" },
      ])
      dogfoodIntegration.failEmail = false
      await provisionDogfood(corrected)
      expect((await db.select().from(organization)).filter((row) => row.id !== unrelated.id))
        .toEqual(organizations)
      expect((await db.select().from(agent)).filter((row) => row.organizationId !== unrelated.id))
        .toEqual(agents)
      expect(vi.mocked(sendResetPasswordEmail).mock.lastCall?.[0].user.email).toBe(corrected.email)
      await completeOwnerPassword(corrected.email)
    })

    test("concurrent provisioning reuses a verified account without sending email", async () => {
      await db.insert(user).values({
        email: ownerOnboardingFixture.email,
        name: "Existing owner",
        emailVerified: true,
      })
      const concurrent = await Promise.allSettled(
        Array.from({ length: 3 }, () => provisionDogfood()),
      )
      expect(concurrent.some((result) => result.status === "fulfilled")).toBe(true)
      await provisionDogfood()
      expect(sendResetPasswordEmail).not.toHaveBeenCalled()
      expect(await db.select().from(organization)).toHaveLength(1)
      expect((await db.select().from(user))[0]?.emailVerified).toBe(true)
    })

    test("an unrelated slug is rejected without taking ownership or trapping setup", async () => {
      const auth = await getAuth()
      const [other] = await db.insert(user).values({ email: "other@example.com", name: "Other" })
        .returning()
      await auth.api.createOrganization({
        body: { userId: other!.id, name: "Existing", slug: "dogfood" },
      })
      await expect(provisionDogfood()).rejects.toMatchObject({ _tag: "OwnerOnboardingError" })
      expect((await getDatabaseConfig()).values.dogfood_pending_setup).toBeUndefined()
      expect(await db.select().from(user)).toHaveLength(1)
      await provisionDogfood({ ...ownerOnboardingFixture, organizationSlug: "newdogfood" })
      expect(await db.select().from(organization)).toHaveLength(2)
    })

    test(
      "configuration requires only operator credentials, including during repair",
      async () => {
        await provisionDogfood()
        const ownerHeaders = await completeOwnerPassword()
        const operator = await createOperatorSession()
        const authorizedCookie = `operator_session=${operator}`
        const fallbackKey = "retired-dogfood-test-encryption-key"
        const listener = createServer()
        await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve))
        const address = listener.address()
        if (!address || typeof address === "string") throw new Error("Missing test port")
        const port = address.port
        await new Promise<void>((resolve) => listener.close(() => resolve()))
        const origin = `http://localhost:${port}`
        const server = spawn(process.execPath, [
          "task",
          "dev",
          "--port",
          String(port),
          "--strictPort",
        ], {
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
        })
        try {
          await vi.waitFor(async () => {
            expect(
              (await fetch(`${origin}/src/routes/configure/-functions/save-config-values.ts`)).ok,
            ).toBe(true)
          }, { timeout: 30_000, interval: 250 })
          const cases = [
            ["save-config-values", { updates: [] }],
            ["generate-config-value", { key: "dogfood_api_key" }],
            ["reveal-config-value", { key: "dogfood_api_key" }],
            ["apply-migrations", { approvedMigrations: [] }],
            ["test-email-provider-connection", {
              provider: "smtp",
              settings: { host: "127.0.0.1", port: 1025, security: "none" },
            }],
          ] as const
          const requests = new Map<string, (cookie: string, input?: unknown) => Promise<Response>>()
          for (const [name, data] of cases) {
            const module =
              await (await fetch(`${origin}/src/routes/configure/-functions/${name}.ts`))
                .text()
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
            for (
              const cookie of ["", ownerHeaders.get("cookie")!]
            ) {
              const response = await request(cookie)
              await response.text()
              expect(response.status).toBe(403)
            }
          }
          for (const name of ["reveal-config-value", "generate-config-value"]) {
            const response = await requests.get(name)!(authorizedCookie)
            expect(response.status).toBe(200)
            const result = fromCrossJSON(await response.json() as SerovalNode, {}) as {
              result: unknown
            }
            expect(result.result).toMatchObject({ ok: false })
            expect(result.result).not.toHaveProperty("value")
          }
          const before = (await getDatabaseConfig()).values.privacy_policy_url
          const acquired = Promise.withResolvers<void>()
          const release = Promise.withResolvers<void>()
          const lock = runDatabaseEffect(withDogfoodProvisioningLock(Effect.promise(() => {
            acquired.resolve()
            return release.promise
          })))
          try {
            await acquired.promise
            const response = await requests.get("save-config-values")!(
              authorizedCookie,
              {
                updates: [{ key: "privacy_policy_url", value: "https://example.com/blocked" }],
              },
            )
            expect(response.status).toBe(409)
            await response.text()
            expect((await getDatabaseConfig()).values.privacy_policy_url).toBe(before)
          } finally {
            release.resolve()
            await lock
          }
          const configured = (await getDatabaseConfig()).values
          for (const key of ["dogfood_organization_id", "dogfood_api_key"] as const) {
            const encrypted = encryptDatabaseValue({
              value: { key, value: configured[key]! },
              decode: decodeConfigValuePayload,
              keyring: parseDatabaseEncryptionKeyring(fallbackKey),
            })
            await db.execute(sql`update config set value = ${encrypted} where key = ${key}`)
          }
          const response = await requests.get("save-config-values")!(authorizedCookie)
          const result = fromCrossJSON(await response.json() as SerovalNode, {}) as {
            result: unknown
          }
          expect(result.result).toEqual({ ok: true })
          // This process only has the active key, so a read proves the fallback can be retired.
          expect((await getDatabaseConfig()).values).toEqual(configured)
        } finally {
          server.kill("SIGTERM")
          await new Promise<void>((resolve) => {
            if (server.exitCode !== null || server.signalCode !== null) resolve()
            else server.once("exit", () => resolve())
          })
        }
      },
      60_000,
    )
  },
)
