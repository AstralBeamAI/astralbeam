import { beforeEach, describe, expect, test, vi } from "vitest"

const state = vi.hoisted(() => ({
  rows: null as { key: string; value: unknown; updatedAt: Date }[] | null,
}))

vi.mock("@/db/index.server", () => ({
  db: {
    select: () => ({
      from: () => {
        if (state.rows === null) {
          return Promise.reject(Object.assign(new Error("missing table"), { code: "42P01" }))
        }
        return Promise.resolve(state.rows)
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

  test("a selected email provider requires its credential", () => {
    const issues = validateConfigCompleteness({
      app_base_url: "http://localhost:3000",
      better_auth_secret: SECRET,
      email_provider: "resend",
    })
    expect(issues.some((issue) => issue.key === "resend_api_key")).toBe(true)
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
    expect(serialized).toContain("google")
  })
})

describe("setup gate boundary", () => {
  beforeEach(() => {
    invalidateConfigCache()
  })

  test("returns 503 with retry-after while the config table is missing", async () => {
    state.rows = null
    const response = await setupGateResponse()
    expect(response?.status).toBe(503)
    expect(response?.headers.get("retry-after")).toBe("10")
  })

  test("returns null once setup is complete", async () => {
    state.rows = completeRows
    await expect(setupGateResponse()).resolves.toBeNull()
  })
})
