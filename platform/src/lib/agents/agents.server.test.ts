import { assert, describe, it } from "@effect/vitest"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Cause, Effect, Exit, Layer } from "effect"

import { Database, type EffectDatabase } from "@/db/database.server"
import { Agents, defaultAgentName } from "./agents.server.ts"
import { formatAgentId } from "./schemas.ts"

const ORGANIZATION_ID = "01990a5d-ac96-774b-b942-6b13c85384cb"
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

  it("names the starter agent within the length the agent form accepts", () => {
    const name = defaultAgentName(`${"Organization".repeat(10)} Holdings`)
    assert.isAtMost(name.length, 100)
    assert.isTrue(name.endsWith(" Assistant"))
  })
})
