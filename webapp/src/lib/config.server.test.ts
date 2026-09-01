import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import type { ConfigStorageEntry, ConfigValues } from "@/lib/types"

const configRepositoryState = vi.hoisted(() => ({
  result: {
    rows: null as ConfigStorageEntry[] | null,
    values: {},
  },
}))
const migrationTestState = vi.hoisted(() => ({ pending: false }))

vi.mock("@/db/config.server", () => ({
  getDatabaseConfig: () => Promise.resolve(configRepositoryState.result),
}))

vi.mock("@/db/migration-runner.server", () => ({
  getDatabaseMigrationState: () =>
    Promise.resolve({
      pending: migrationTestState.pending ? [{ name: "pending" }] : [],
      appliedCount: 0,
    }),
}))

import {
  CONFIG_DEFINITIONS,
  configEnvironmentVariable,
  findConfigDefinition,
  validateConfigCompleteness,
} from "@/lib/config/registry.server"
import { getGlobalConfigState, invalidateGlobalConfig } from "@/lib/config/runtime.server"
import { publicConfigFromValues, setupGateResponse } from "@/lib/config/state.server"

const CONFIG_TEST_SECRET = "a".repeat(64)

function completeStoredConfig() {
  const values: ConfigValues = {
    app_base_url: "http://localhost:3000",
    better_auth_secret: CONFIG_TEST_SECRET,
    turnstile_site_key: "turnstile-site-key",
    turnstile_secret_key: "turnstile-secret-key",
  }
  return {
    rows: Object.keys(values).map((key) => ({ key })),
    values,
  }
}

function setStoredConfig(result: {
  readonly rows: ConfigStorageEntry[] | null
  readonly values: ConfigValues
}) {
  configRepositoryState.result = result
  invalidateGlobalConfig()
}

beforeEach(() => {
  migrationTestState.pending = false
  setStoredConfig({ rows: null, values: {} })
  for (const definition of CONFIG_DEFINITIONS) {
    vi.stubEnv(configEnvironmentVariable(definition.key), "")
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("global configuration", () => {
  test("environment values override stored values while defaults remain available", async () => {
    setStoredConfig(completeStoredConfig())
    vi.stubEnv("APP_BASE_URL", JSON.stringify("https://environment.example"))
    vi.stubEnv("BETTER_AUTH_SECRET", JSON.stringify("b".repeat(64)))
    vi.stubEnv("SMTP_PORT", "587")

    const { values } = await getGlobalConfigState()

    expect(values).toMatchObject({
      app_base_url: "https://environment.example",
      better_auth_secret: "b".repeat(64),
      email_provider: "smtp",
      smtp_host: "127.0.0.1",
      smtp_port: "587",
      smtp_security: "none",
    })
  })

  test("public output cannot disclose stored secrets", () => {
    const serialized = JSON.stringify(publicConfigFromValues({
      ...completeStoredConfig().values,
      google_client_id: "google-id",
      google_client_secret: "google-secret",
      openai_api_key: "openai-secret",
    }))

    expect(serialized).toContain("turnstile-site-key")
    expect(serialized).not.toContain("google-secret")
    expect(serialized).not.toContain("openai-secret")
    expect(serialized).not.toContain(CONFIG_TEST_SECRET)
    expect(serialized).not.toContain("turnstile-secret-key")
  })

  test("unreadable secrets keep only their required or selected features incomplete", async () => {
    const complete = completeStoredConfig()
    const requiredMissing = { ...complete.values }
    delete requiredMissing.better_auth_secret
    setStoredConfig({
      rows: [
        ...(complete.rows ?? []).filter((row) => row.key !== "better_auth_secret"),
        { key: "better_auth_secret", storageStatus: "unreadable" },
        { key: "resend_api_key", storageStatus: "unreadable" },
      ],
      values: {
        ...requiredMissing,
        email_from_address: "hello@example.com",
        email_provider: "resend",
      },
    })

    const dependentIssues = (await getGlobalConfigState()).issues.map((issue) => issue.key)
    expect(dependentIssues).toEqual(
      expect.arrayContaining(["better_auth_secret", "resend_api_key"]),
    )

    setStoredConfig({
      ...complete,
      rows: [
        ...(complete.rows ?? []),
        { key: "openai_api_key", storageStatus: "unreadable" },
      ],
    })
    expect((await getGlobalConfigState()).issues).toEqual([])
  })

  test("a malformed from address is rejected instead of reaching the provider", () => {
    const definition = findConfigDefinition("email_from_address")
    if (!definition) throw new Error("Expected an email_from_address definition")

    expect(() => definition.decode("onboarding.resend.dev")).toThrow(
      /must be 'email@example.com' or 'Name <email@example.com>'/,
    )
    // The error must not repeat the rejected value, which the operator may have mistyped a secret into.
    expect(() => definition.decode("secret@@value")).not.toThrow(/secret/)
    expect(definition.decode("onboarding@resend.dev")).toBe("onboarding@resend.dev")
    expect(definition.decode("App <onboarding@resend.dev>")).toBe("App <onboarding@resend.dev>")

    expect(
      validateConfigCompleteness({
        app_base_url: "http://localhost:3000",
        better_auth_secret: CONFIG_TEST_SECRET,
        turnstile_site_key: "turnstile-site-key",
        turnstile_secret_key: "turnstile-secret-key",
        email_provider: "resend",
        resend_api_key: "resend-api-key",
      }).map((issue) => issue.key),
    ).toContain("email_from_address")
  })
})

describe("setup gate and configuration cache", () => {
  test("returns 503 until both configuration and migrations are ready", async () => {
    const bootstrapResponse = await setupGateResponse()
    expect(bootstrapResponse?.status).toBe(503)
    expect(bootstrapResponse?.headers.get("retry-after")).toBe("10")

    setStoredConfig(completeStoredConfig())
    await expect(setupGateResponse()).resolves.toBeNull()

    migrationTestState.pending = true
    invalidateGlobalConfig()
    await expect(setupGateResponse()).resolves.toMatchObject({ status: 503 })
  })
})
