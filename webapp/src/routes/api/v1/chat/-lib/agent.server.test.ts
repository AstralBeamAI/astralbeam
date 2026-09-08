import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"
import { beforeEach, describe, expect, test, vi } from "vitest"

const databaseState = vi.hoisted(() => ({
  joinPredicates: [] as SQL[],
  rows: [] as unknown[][],
  selectCalls: 0,
  wherePredicates: [] as SQL[],
}))

vi.mock("@/db", () => {
  const db = {
    select: () => {
      databaseState.selectCalls += 1
      const rows = databaseState.rows.shift() ?? []
      const query = {
        from: () => query,
        innerJoin: (_table: unknown, predicate: SQL) => {
          databaseState.joinPredicates.push(predicate)
          return query
        },
        where: (predicate: SQL) => {
          databaseState.wherePredicates.push(predicate)
          return query
        },
        limit: () => Effect.succeed(rows),
      }
      return query
    },
  }
  return {
    effectDatabase: Effect.succeed(db),
    runDatabaseEffect: Effect.runPromise,
  }
})

import { resolveChatAgent } from "./agent.server"

const AGENT_ID = "agent_01990a5d-ac96-774b-b942-6b13c85384ca"
const ORGANIZATION_ID = "01990a5d-ac96-774b-b942-6b13c85384ca"

describe("organization agent chat lookup", () => {
  beforeEach(() => {
    databaseState.joinPredicates = []
    databaseState.rows = []
    databaseState.selectCalls = 0
    databaseState.wherePredicates = []
  })

  test("scopes the public agent ID to the authenticated organization", async () => {
    databaseState.rows = [[{ systemPrompt: "Organization default" }]]

    await expect(resolveChatAgent(AGENT_ID, ORGANIZATION_ID)).resolves.toEqual({
      systemPrompt: "Organization default",
    })

    const [wherePredicate] = databaseState.wherePredicates.map(query)
    expect(wherePredicate?.sql).toContain('"agent"."id" = $1')
    expect(wherePredicate?.sql).toContain('"agent"."organization_id" = $2')
    expect(wherePredicate?.params).toEqual([AGENT_ID, ORGANIZATION_ID])
  })

  test.each([
    undefined,
    ORGANIZATION_ID,
    "agt_acme_todo-agent",
    `${AGENT_ID} `,
    "agent_not-a-uuid",
    // UUIDv4, so the version nibble the schema pins to 7 rejects it.
    "agent_01990a5d-ac96-474b-b942-6b13c85384ca",
  ])(
    "returns the same missing result for a non-resolving public ID",
    async (publicId) => {
      await expect(resolveChatAgent(publicId, ORGANIZATION_ID)).resolves.toBeNull()
    },
  )
})

function query(expression: SQL) {
  return new PgDialect().sqlToQuery(expression)
}
