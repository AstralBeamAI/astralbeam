import * as Effect from "effect/Effect"
import { describe, expect, test, vi } from "vitest"

vi.mock("@/db", () => ({
  effectDatabase: Effect.succeed({}),
  runDatabaseEffect: Effect.runPromise,
}))

import { runDatabaseEffect } from "@/db"

import {
  defaultAgentName,
  deleteOrganizationAgent,
  readOrganizationAgentById,
  setOrganizationDefaultAgent,
  updateOrganizationAgent,
} from "./agent.server.ts"

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

test("rejects foreign agent slugs before reads or writes", async () => {
  const input = {
    organizationId: "01990a5d-ac96-774b-b942-6b13c85384cb",
    id: "agent_01990a5d-ac96-774b-b942-6b13c85384cc_01990a5d-ac96-774b-b942-6b13c85384ca",
    lockVersion: 0,
    name: "Changed",
    systemPrompt: "Changed",
    attachmentsEnabled: true,
    sandboxProviderId: null,
  }
  await expect(runDatabaseEffect(readOrganizationAgentById(input))).resolves.toBeNull()
  await expect(runDatabaseEffect(setOrganizationDefaultAgent(input).pipe(Effect.flip)))
    .resolves.toMatchObject({ _tag: "OrganizationDefaultAgentError" })
  await expect(runDatabaseEffect(deleteOrganizationAgent(input).pipe(Effect.flip)))
    .resolves.toMatchObject({ _tag: "OptimisticLockError", reason: "conflict" })
  await expect(runDatabaseEffect(updateOrganizationAgent(input).pipe(Effect.flip)))
    .resolves.toMatchObject({ _tag: "OptimisticLockError", reason: "conflict" })
})
