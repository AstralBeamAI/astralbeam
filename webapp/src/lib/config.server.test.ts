import { beforeEach, describe, expect, test, vi } from "vitest"

const configTestState = vi.hoisted(() => ({
  rows: null as { key: string; value: unknown; updatedAt: Date }[] | null,
}))

vi.mock("@/db/index.server", () => ({
  db: {
    select: () => ({
      from: () => {
        if (configTestState.rows === null) {
          return Promise.reject(Object.assign(new Error("missing table"), { code: "42P01" }))
        }
        return Promise.resolve(configTestState.rows)
      },
    }),
  },
}))

import {
  buildConfigSnapshot,
  invalidateConfigCache,
  publicConfigFromSnapshot,
  setupGateResponse,
  validateConfigCompleteness,
} from "@/lib/config.server"

const SECRET = "a".repeat(64)
const NOW = new Date("2026-08-25T00:00:00Z")

function row(key: string, value: unknown) {
  return { key, value, updatedAt: NOW }
}

const completeRows = [
  row("app_base_url", "http://localhost:3000"),
  row("better_auth_secret", SECRET),
  row("turnstile_site_key", "turnstile-site-key"),
  row("turnstile_secret_key", "turnstile-secret-key"),
  row("setup_completed", true),
]

describe("config snapshot boundary", () => {
  test("setup stays incomplete until every required key is valid", () => {
    const withoutBaseUrl = buildConfigSnapshot([
      row("better_auth_secret", SECRET),
      row("setup_completed", true),
    ])
    expect(withoutBaseUrl.setupComplete).toBe(false)

    expect(buildConfigSnapshot(completeRows).setupComplete).toBe(true)
  })

  test("setup requires the explicit completion marker", () => {
    const withoutMarker = buildConfigSnapshot([
      row("app_base_url", "http://localhost:3000"),
      row("better_auth_secret", SECRET),
    ])
    expect(withoutMarker.setupComplete).toBe(false)
  })

  test("invalid stored values are treated as unset instead of surfacing", () => {
    const snapshot = buildConfigSnapshot([
      ...completeRows,
      row("privacy_policy_url", "not a url"),
    ])
    expect(snapshot.privacyPolicyUrl).not.toContain("not a url")
    expect(snapshot.setupComplete).toBe(true)
  })

  test("an oauth provider is enabled only when both credentials are set", () => {
    const partial = buildConfigSnapshot([...completeRows, row("google_client_id", "id")])
    expect(partial.google).toBeNull()
    expect(partial.setupComplete).toBe(false)

    const paired = buildConfigSnapshot([
      ...completeRows,
      row("google_client_id", "id"),
      row("google_client_secret", "secret"),
    ])
    expect(paired.google).toEqual({ clientId: "id", clientSecret: "secret" })
  })

  test("setup requires both turnstile keys", () => {
    for (const missingKey of ["turnstile_site_key", "turnstile_secret_key"]) {
      const partial = buildConfigSnapshot(
        completeRows.filter((configRow) => configRow.key !== missingKey),
      )
      expect(partial.turnstile).toBeNull()
      expect(partial.setupComplete).toBe(false)
    }

    expect(buildConfigSnapshot(completeRows).turnstile).toEqual({
      siteKey: "turnstile-site-key",
      secretKey: "turnstile-secret-key",
    })
  })

  test("a malformed from address is rejected instead of reaching the provider", () => {
    const malformed = buildConfigSnapshot([
      ...completeRows,
      row("email_from_address", "onboarding.resend.dev"),
    ])
    expect(malformed.emailFromAddress).toBeNull()

    const named = buildConfigSnapshot([
      ...completeRows,
      row("email_from_address", "App <onboarding@resend.dev>"),
    ])
    expect(named.emailFromAddress).toBe("App <onboarding@resend.dev>")
  })

  test("a selected email provider requires its credential", () => {
    const issues = validateConfigCompleteness({
      app_base_url: "http://localhost:3000",
      better_auth_secret: SECRET,
      email_provider: "resend",
    })
    expect(issues.some((issue) => issue.key === "resend_api_key")).toBe(true)
  })

  test("static aws credentials must be set as a pair", () => {
    const issues = validateConfigCompleteness({
      app_base_url: "http://localhost:3000",
      better_auth_secret: SECRET,
      aws_access_key_id: "AKIA123",
    })
    expect(issues.some((issue) => issue.key === "aws_secret_access_key")).toBe(true)
  })

  test("the public config projection never contains secret values", () => {
    const snapshot = buildConfigSnapshot([
      ...completeRows,
      row("google_client_id", "google-id"),
      row("google_client_secret", "google-secret-value"),
      row("openai_api_key", "openai-secret-value"),
      row("chat_auth_secret", SECRET),
    ])
    const serialized = JSON.stringify(publicConfigFromSnapshot(snapshot))
    expect(serialized).not.toContain("google-secret-value")
    expect(serialized).not.toContain("openai-secret-value")
    expect(serialized).not.toContain(SECRET)
    expect(serialized).not.toContain("turnstile-secret-key")
    expect(serialized).toContain("turnstile-site-key")
    expect(serialized).toContain("google")
  })
})

describe("setup gate boundary", () => {
  beforeEach(() => {
    invalidateConfigCache()
  })

  test("returns 503 with retry-after while the config table is missing", async () => {
    configTestState.rows = null
    const response = await setupGateResponse()
    expect(response?.status).toBe(503)
    expect(response?.headers.get("retry-after")).toBe("10")
  })

  test("returns null once setup is complete", async () => {
    configTestState.rows = completeRows
    await expect(setupGateResponse()).resolves.toBeNull()
  })
})
