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

describe("organization agent chat lookup", () => {
  beforeEach(() => {
    databaseState.joinPredicates = []
    databaseState.rows = []
    databaseState.selectCalls = 0
    databaseState.wherePredicates = []
  })

  test("scopes the public agent slug to the authenticated organization", async () => {
    databaseState.rows = [[{ systemPrompt: "Organization default" }]]

    await expect(
      resolveChatAgent(
        "agt_acme_todos",
        "01990a5d-ac96-774b-b942-6b13c85384ca",
      ),
    ).resolves.toEqual({ systemPrompt: "Organization default" })

    const [joinPredicate] = databaseState.joinPredicates.map(query)
    const [wherePredicate] = databaseState.wherePredicates.map(query)
    expect(joinPredicate?.sql).toContain('"agent"."organization_id" = "organization"."id"')
    expect(joinPredicate?.sql).toContain('"agent"."slug" = $1')
    expect(joinPredicate?.params).toEqual(["todos"])
    expect(wherePredicate?.sql).toContain('"organization"."slug" = $1')
    expect(wherePredicate?.sql).toContain('"agent"."organization_id" = $2')
    expect(wherePredicate?.params).toEqual([
      "acme",
      "01990a5d-ac96-774b-b942-6b13c85384ca",
    ])
  })

  test.each([undefined, "agt_acme_other", "agt_acme_bad-slug", "agt_acme_other_extra"])(
    "returns the same missing result for a non-resolving public ID",
    async (publicId) => {
      await expect(
        resolveChatAgent(publicId, "01990a5d-ac96-774b-b942-6b13c85384ca"),
      ).resolves.toBeNull()
    },
  )
})

function query(expression: SQL) {
  return new PgDialect().sqlToQuery(expression)
}
