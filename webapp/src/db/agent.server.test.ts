import * as Effect from "effect/Effect"
import { describe, expect, test, vi } from "vitest"

vi.mock("@/db", () => ({
  effectDatabase: Effect.succeed({}),
  runDatabaseEffect: Effect.runPromise,
}))

import { defaultAgentName } from "./agent.server.ts"

describe("starter agent name", () => {
  test("names the agent after its organization", () => {
    expect(defaultAgentName("ACME Corp")).toBe("ACME Corp Assistant")
  })

  test("stays within the length the agent form accepts", () => {
    const name = defaultAgentName(`${"Organization".repeat(10)} Holdings`)
    expect(name.length).toBeLessThanOrEqual(100)
    expect(name.endsWith(" Assistant")).toBe(true)
  })
})
