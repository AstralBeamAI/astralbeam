import { beforeEach, describe, expect, test, vi } from "vitest"

const configurePageTestState = vi.hoisted(() => ({
  operatorSessionCalls: 0,
  rateLimitError: undefined as unknown,
}))

vi.mock("../-lib/configure-request.server", () => ({ requireConfigureRequest: () => undefined }))
vi.mock("@/db/index.server", () => ({
  db: {
    execute: () =>
      configurePageTestState.rateLimitError === undefined
        ? Promise.resolve([])
        : Promise.reject(configurePageTestState.rateLimitError),
  },
}))
vi.mock("@/db/lib/database-credentials.server", () => ({
  getDatabaseBootstrapIssues: () => [],
  getDatabaseEncryptionKeyring: () => [new Uint8Array(32)],
}))
vi.mock("../-lib/operator-session.server", () => ({
  getOperatorSession: () => {
    configurePageTestState.operatorSessionCalls += 1
    return Promise.resolve(null)
  },
}))

import { loadConfigurePageState } from "./get-configure-page-state.server.ts"

beforeEach(() => {
  configurePageTestState.operatorSessionCalls = 0
  configurePageTestState.rateLimitError = undefined
})

describe("configure page migration gate", () => {
  test("blocks operator sign-in until the configure rate-limit table is ready", async () => {
    configurePageTestState.rateLimitError = Object.assign(new Error("relation does not exist"), {
      code: "42P01",
    })

    await expect(loadConfigurePageState()).resolves.toEqual({ status: "migrations-required" })
    expect(configurePageTestState.operatorSessionCalls).toBe(0)
  })

  test("does not hide other database failures", async () => {
    configurePageTestState.rateLimitError = Object.assign(new Error("permission denied"), {
      code: "42501",
    })

    await expect(loadConfigurePageState()).rejects.toMatchObject({ code: "42501" })
  })
})
