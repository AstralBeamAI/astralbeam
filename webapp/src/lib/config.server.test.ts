import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
const configTestState = vi.hoisted(() => ({
  rows: null as { key: string; value: string }[] | null,
  selectCount: 0,
}))

vi.mock("@/db/index.server", () => ({
  db: {
    select: (selection: Record<string, unknown>) => {
      configTestState.selectCount += 1
      return {
        from: () => {
          if (configTestState.rows === null) {
            return Promise.reject(Object.assign(new Error("missing table"), { code: "42P01" }))
          }
          const rows = Promise.resolve().then(() =>
            configTestState.rows!.map((row) => ({
              key: row.key,
              ...(selection.value && typeof selection.value === "object" &&
                  "mapFromDriverValue" in selection.value
                ? {
                  value: (selection.value as {
                    mapFromDriverValue: (value: string) => unknown
                  }).mapFromDriverValue(row.value),
                }
                : {}),
              ...(selection.storedValue ? { storedValue: row.value } : {}),
            }))
          )
          return Object.assign(rows, { where: () => rows })
        },
      }
    },
  },
}))

import {
  CONFIG_DEFINITIONS,
  configEnvironmentVariable,
  validateConfigCompleteness,
} from "@/lib/config/registry.server"
import { getGlobalConfigState, invalidateGlobalConfig } from "@/lib/config/runtime.server"
import {
  isSetupComplete,
  publicConfigFromValues,
  setupGateResponse,
} from "@/lib/config/state.server"
import { configTable } from "@/db/schema/config.server"
import { getGlobalConfig } from "@/lib/config"

const CONFIG_TEST_SECRET = "a".repeat(64)
function configTestRow(key: string, value: string) {
  const storedValue = configTable.value.mapToDriverValue({ key, value })
  if (typeof storedValue !== "string") throw new Error("Expected a stored config string")
  return { key, value: storedValue }
}

function rawConfigTestRow(key: string, value: string) {
  return { key, value }
}

function completeConfigTestRows() {
  return [
    configTestRow("app_base_url", "http://localhost:3000"),
    configTestRow("better_auth_secret", CONFIG_TEST_SECRET),
    configTestRow("turnstile_site_key", "turnstile-site-key"),
    configTestRow("turnstile_secret_key", "turnstile-secret-key"),
  ]
}

async function loadGlobalConfig(rows: { key: string; value: string }[]) {
  configTestState.rows = rows
  invalidateGlobalConfig()
  return await getGlobalConfigState()
}

beforeEach(() => {
  configTestState.selectCount = 0
  invalidateGlobalConfig()
  for (const definition of CONFIG_DEFINITIONS) {
    vi.stubEnv(configEnvironmentVariable(definition.key), "")
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("config value boundary", () => {
  test("environment values override stored values without changing the database", async () => {
    vi.stubEnv("APP_BASE_URL", JSON.stringify("https://environment.example"))
    vi.stubEnv("BETTER_AUTH_SECRET", JSON.stringify("b".repeat(64)))
    vi.stubEnv("SMTP_PORT", "587")
    const { values } = await loadGlobalConfig(completeConfigTestRows())
    expect(values.app_base_url).toBe("https://environment.example")
    expect(values.better_auth_secret).toBe("b".repeat(64))
    expect(values.email_provider).toBe("smtp")
    expect(values.smtp_host).toBe("127.0.0.1")
    expect(values.smtp_port).toBe("587")
    expect(values.smtp_security).toBe("none")
  })

  test("malformed encrypted values fail closed and remain replaceable", async () => {
    const completeRows = completeConfigTestRows()
    expect((await loadGlobalConfig(completeRows)).values.better_auth_secret).toBe(
      CONFIG_TEST_SECRET,
    )
    const malformedRows = completeRows.map((row) =>
      row.key === "better_auth_secret" ? rawConfigTestRow(row.key, CONFIG_TEST_SECRET) : row
    )
    const malformed = await loadGlobalConfig(malformedRows)
    expect(malformed.values.better_auth_secret).toBeUndefined()
    expect(validateConfigCompleteness(malformed.values)).not.toEqual([])

    const substituted = configTestRow("openai_api_key", CONFIG_TEST_SECRET)
    const mismatched = await loadGlobalConfig([
      ...completeRows.filter((row) => row.key !== "better_auth_secret"),
      rawConfigTestRow("better_auth_secret", substituted.value),
    ])
    expect(mismatched.values.better_auth_secret).toBeUndefined()
  })

  test("an unreadable optional secret disables only its dependent feature", async () => {
    const selectedProvider = await loadGlobalConfig([
      ...completeConfigTestRows(),
      configTestRow("email_provider", "resend"),
      configTestRow("email_from_address", "hello@example.com"),
      rawConfigTestRow("resend_api_key", "malformed stored value"),
    ])
    expect(validateConfigCompleteness(selectedProvider.values)).not.toEqual([])
    expect(selectedProvider.values.email_provider).toBe("resend")
    expect(selectedProvider.values.resend_api_key).toBeUndefined()

    const unrelated = await loadGlobalConfig([
      ...completeConfigTestRows(),
      rawConfigTestRow("openai_api_key", "malformed stored value"),
    ])
    expect(validateConfigCompleteness(unrelated.values)).toEqual([])
    expect(unrelated.values.openai_api_key).toBeUndefined()
  })

  test("selected email providers require their delivery settings", async () => {
    const selectedProvider = await loadGlobalConfig([
      ...completeConfigTestRows(),
      configTestRow("email_provider", "resend"),
      configTestRow("resend_api_key", "resend-key"),
    ])
    expect(validateConfigCompleteness(selectedProvider.values)).toContainEqual({
      key: "email_from_address",
      message: "An email from address is required when an email provider is selected",
    })
    expect(validateConfigCompleteness({
      email_provider: "smtp",
      smtp_host: "smtp.example.com",
      smtp_port: "587",
      smtp_security: "starttls",
      smtp_username: "mailer",
    })).toContainEqual({
      key: "smtp_password",
      message: "SMTP Password is required when its pair is configured",
    })
  })

  test("public output stays secret-free", async () => {
    const completeRows = completeConfigTestRows()
    const { values } = await loadGlobalConfig([
      ...completeRows,
      configTestRow("google_client_id", "google-id"),
      configTestRow("google_client_secret", "google-secret"),
      configTestRow("openai_api_key", "openai-secret"),
    ])
    expect(values.google_client_secret).toBe("google-secret")
    const serialized = JSON.stringify(publicConfigFromValues(values))
    expect(serialized).toContain("google")
    expect(serialized).not.toContain("google-secret")
    expect(serialized).not.toContain("openai-secret")
    expect(serialized).not.toContain(CONFIG_TEST_SECRET)
    expect(serialized).not.toContain("turnstile-secret-key")
    expect(serialized).toContain("turnstile-site-key")
  })
})

describe("setup gate and cache boundary", () => {
  test("returns 503 until configuration is complete", async () => {
    configTestState.rows = null
    const response = await setupGateResponse()
    expect(response?.status).toBe(503)
    expect(response?.headers.get("retry-after")).toBe("10")

    configTestState.rows = completeConfigTestRows()
    invalidateGlobalConfig()
    await expect(setupGateResponse()).resolves.toBeNull()
  })

  test("reads configuration once per process and once after invalidation", async () => {
    configTestState.rows = completeConfigTestRows()
    const [, state, secret] = await Promise.all([
      isSetupComplete(),
      getGlobalConfigState(),
      getGlobalConfig("better_auth_secret"),
    ])
    await isSetupComplete()
    expect(configTestState.selectCount).toBe(1)
    expect(state.rows?.map((row) => row.key)).toEqual(
      configTestState.rows.map((row) => row.key),
    )
    expect(state.values.better_auth_secret).toBe(CONFIG_TEST_SECRET)
    expect(state.rows?.find((row) => row.key === "better_auth_secret")?.storageStatus)
      .toBeUndefined()
    expect(secret).toBe(CONFIG_TEST_SECRET)

    invalidateGlobalConfig()
    await Promise.all([isSetupComplete(), isSetupComplete()])
    expect(configTestState.selectCount).toBe(2)
  })
})
