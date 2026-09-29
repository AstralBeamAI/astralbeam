import { assert, describe, it } from "@effect/vitest"
import type { SQL } from "drizzle-orm"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { PgDialect } from "drizzle-orm/pg-core"
import { Cause, Effect, Exit, Layer } from "effect"

import { Database, type EffectDatabase } from "@/db/database.server"
import { Agents, defaultAgentName } from "./agents.server.ts"
import { formatAgentId } from "./schemas.ts"

const ORGANIZATION_ID = "01990a5d-ac96-774b-b942-6b13c85384cb"
const STORED_AGENT_ID = "01990a5d-ac96-774b-b942-6b13c85384cd"
const FOREIGN_AGENT_ID = formatAgentId({
  organizationId: "01990a5d-ac96-774b-b942-6b13c85384cc",
  id: "01990a5d-ac96-774b-b942-6b13c85384ca",
})
const FIELDS = {
  name: "Support",
  systemPrompt: "Help",
  attachmentsEnabled: true,
  sandboxProviderId: null,
}

// Any query throws, so a passing test proves the refusal happened before the database was reached.
const untouchedDatabase = Layer.succeed(Database, {} as EffectDatabase)

// Records each predicate a select builds, so a test can check the SQL scoping without a database.
function selectRecording(rows: readonly unknown[]) {
  const predicates = { join: [] as SQL[], where: [] as SQL[] }
  const query = {
    from: () => query,
    innerJoin: (_table: unknown, predicate: SQL) => {
      predicates.join.push(predicate)
      return query
    },
    where: (predicate: SQL) => {
      predicates.where.push(predicate)
      return query
    },
    limit: () => Effect.succeed(rows),
  }
  const database = { select: () => query } as unknown as EffectDatabase
  return {
    predicates,
    layer: Agents.layerNoDeps.pipe(Layer.provide(Layer.succeed(Database, database))),
  }
}

function agentSql(expression: SQL | undefined) {
  return new PgDialect().sqlToQuery(expression!)
}

function insertFailing(cause: object) {
  const failure = new EffectDrizzleQueryError({ query: "insert", params: ["secret"], cause })
  return Layer.succeed(Database, {
    insert: () => ({ values: () => ({ returning: () => Effect.fail(failure) }) }),
  } as unknown as EffectDatabase)
}

describe("Agents", () => {
  it.effect("refuses another organization's agent ID before any query", () =>
    Effect.gen(function* () {
      const agents = yield* Agents
      const input = { organizationId: ORGANIZATION_ID, agentId: FOREIGN_AGENT_ID }
      assert.strictEqual((yield* Effect.flip(agents.get(input)))._tag, "AgentNotFound")
      assert.strictEqual((yield* Effect.flip(agents.setDefault(input)))._tag, "AgentNotFound")
      const versioned = { ...input, lockVersion: 0 }
      assert.strictEqual((yield* Effect.flip(agents.remove(versioned)))._tag, "AgentChanged")
      const update = agents.update({ ...versioned, fields: FIELDS })
      assert.strictEqual((yield* Effect.flip(update))._tag, "AgentChanged")
    }).pipe(Effect.provide(Agents.layerNoDeps.pipe(Layer.provide(untouchedDatabase)))),
  )

  it.effect("maps the name constraint to a user-facing error and other failures to defects", () =>
    Effect.gen(function* () {
      const create = Effect.flatMap(Agents, (agents) =>
        agents.create({ organizationId: ORGANIZATION_ID, fields: FIELDS }),
      )
      const nameTaken = insertFailing({ constraint: "agent_organization_id_name_uidx" })
      const taken = yield* create.pipe(
        Effect.flip,
        Effect.provide(Agents.layerNoDeps.pipe(Layer.provide(nameTaken))),
      )
      assert.strictEqual(taken._tag, "AgentNameTaken")

      const outage = insertFailing({ code: "08006" })
      const exit = yield* create.pipe(
        Effect.exit,
        Effect.provide(Agents.layerNoDeps.pipe(Layer.provide(outage))),
      )
      assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause))
    }),
  )

  it.effect("scopes a chat agent ID to the authenticated organization", () => {
    const row = {
      id: STORED_AGENT_ID,
      systemPrompt: "Help",
      attachmentsEnabled: true,
      sandboxProviderId: null,
    }
    const { predicates, layer } = selectRecording([row])
    return Effect.gen(function* () {
      const agents = yield* Agents
      const agentId = formatAgentId({ organizationId: ORGANIZATION_ID, id: STORED_AGENT_ID })
      const selected = yield* agents.resolveForChat({ organizationId: ORGANIZATION_ID, agentId })
      assert.deepStrictEqual(selected, row)
      const where = agentSql(predicates.where[0])
      assert.include(where.sql, '"agent"."id" = $1')
      assert.include(where.sql, '"agent"."organization_id" = $2')
      assert.deepStrictEqual(where.params, [STORED_AGENT_ID, ORGANIZATION_ID])
    }).pipe(Effect.provide(layer))
  })

  it.effect("refuses malformed, non-string, and foreign chat agent IDs before any query", () =>
    Effect.gen(function* () {
      const agents = yield* Agents
      for (const agentId of [
        `agent_${STORED_AGENT_ID}`,
        `${formatAgentId({ organizationId: ORGANIZATION_ID, id: STORED_AGENT_ID })}\n`,
        42,
        FOREIGN_AGENT_ID,
      ]) {
        const refused = yield* Effect.flip(
          agents.resolveForChat({ organizationId: ORGANIZATION_ID, agentId }),
        )
        assert.strictEqual(refused._tag, "AgentNotFound")
      }
    }).pipe(Effect.provide(Agents.layerNoDeps.pipe(Layer.provide(untouchedDatabase)))),
  )

  it.effect("joins the default chat agent through both organization-owned rows", () => {
    const { predicates, layer } = selectRecording([])
    return Effect.gen(function* () {
      const agents = yield* Agents
      const missing = yield* Effect.flip(
        agents.resolveForChat({ organizationId: ORGANIZATION_ID, agentId: undefined }),
      )
      assert.strictEqual(missing._tag, "AgentNotFound")
      const join = agentSql(predicates.join[0])
      assert.include(join.sql, '"agent"."id" = "organization_configuration"."default_agent_id"')
      assert.include(
        join.sql,
        '"agent"."organization_id" = "organization_configuration"."organization_id"',
      )
      assert.deepStrictEqual(agentSql(predicates.where[0]).params, [ORGANIZATION_ID])
    }).pipe(Effect.provide(layer))
  })

  it("names the starter agent within the length the agent form accepts", () => {
    const name = defaultAgentName(`${"Organization".repeat(10)} Holdings`)
    assert.isAtMost(name.length, 100)
    assert.isTrue(name.endsWith(" Assistant"))
  })
})
