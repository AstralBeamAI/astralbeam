import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"
import { beforeEach, describe, expect, test, vi } from "vitest"

const databaseState = vi.hoisted(() => ({
  joinPredicates: [] as SQL[],
  rows: [] as unknown[][],
  wherePredicates: [] as SQL[],
}))

vi.mock("@/db", () => {
  const db = {
    select: () => {
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

const STORED_AGENT_ID = "01990a5d-ac96-774b-b942-6b13c85384ca"
const AGENT_ID = `agent_${STORED_AGENT_ID}`
const ORGANIZATION_ID = "01990a5d-ac96-774b-b942-6b13c85384ca"

describe("organization agent chat lookup", () => {
  beforeEach(() => {
    databaseState.joinPredicates = []
    databaseState.rows = []
    databaseState.wherePredicates = []
  })

  test("queries the stored UUID behind the public agent ID, scoped to the organization", async () => {
    databaseState.rows = [[{ systemPrompt: "Organization default" }]]

    await expect(resolveChatAgent(AGENT_ID, ORGANIZATION_ID)).resolves.toEqual({
      systemPrompt: "Organization default",
    })

    const [wherePredicate] = databaseState.wherePredicates.map(query)
    expect(wherePredicate?.sql).toContain('"agent"."id" = $1')
    expect(wherePredicate?.sql).toContain('"agent"."organization_id" = $2')
    expect(wherePredicate?.params).toEqual([STORED_AGENT_ID, ORGANIZATION_ID])
  })

  test("rejects a bare stored UUID, which is not a public agent ID", async () => {
    await expect(resolveChatAgent(STORED_AGENT_ID, ORGANIZATION_ID)).resolves.toBeNull()
    expect(databaseState.wherePredicates).toHaveLength(0)
  })

  test("default lookup joins and scopes both organization-owned rows", async () => {
    await expect(resolveChatAgent(undefined, ORGANIZATION_ID)).resolves.toBeNull()
    const join = query(databaseState.joinPredicates[0]!)
    expect(join.sql).toContain('"agent"."id" = "organization_configuration"."default_agent_id"')
    expect(join.sql).toContain(
      '"agent"."organization_id" = "organization_configuration"."organization_id"',
    )
    expect(query(databaseState.wherePredicates[0]!).params).toEqual([ORGANIZATION_ID])
    await expect(resolveChatAgent("invalid", ORGANIZATION_ID)).resolves.toBeNull()
    expect(databaseState.wherePredicates).toHaveLength(1)
  })
})

function query(expression: SQL) {
  return new PgDialect().sqlToQuery(expression)
}
