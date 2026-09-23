import process from "node:process"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, ManagedRuntime, Redacted } from "effect"
import { loadEnv } from "vite"
import { clusterClientLayer } from "../src/cluster/runtime.server.ts"
import { exampleWorkflow } from "../src/workflows/example.server.ts"
import { workflowDefinitions } from "../src/workflows/registry.server.ts"

const [workflowCommand, workflowArgument, workflowSecondArgument] = process.argv.slice(2)
if (!["cancel", "example", "result"].includes(workflowCommand ?? "")) {
  throw new Error(
    "Usage: workflows example <key> [run-at-ISO], workflows <cancel|result> <workflow-name> <execution-id>",
  )
}
const workflowOperatorEnv = loadEnv("development", process.cwd(), "")
const workflowDatabaseUrl = process.env.DATABASE_URL ?? workflowOperatorEnv.DATABASE_URL
if (!workflowDatabaseUrl) throw new Error("DATABASE_URL is required")
const workflowOperatorRuntime = ManagedRuntime.make(
  clusterClientLayer.pipe(
    Layer.provideMerge(
      PgClient.layer({
        url: Redacted.make(workflowDatabaseUrl),
        prepare: false,
      }),
    ),
  ),
)
try {
  const result = await workflowOperatorRuntime.runPromise(
    Effect.gen(function* () {
      if (workflowCommand === "example") {
        if (!workflowArgument) return yield* Effect.fail(new Error("Example key required"))
        const runAt =
          workflowSecondArgument === undefined ? undefined : Date.parse(workflowSecondArgument)
        if (runAt !== undefined && !Number.isFinite(runAt)) {
          return yield* Effect.fail(new Error("Expected an ISO timestamp"))
        }
        return yield* exampleWorkflow.execute({ key: workflowArgument, runAt }, { discard: true })
      }
      if (!workflowArgument || !workflowSecondArgument) {
        return yield* Effect.fail(new Error("Workflow name and execution ID required"))
      }
      const definition = workflowDefinitions.find((entry) => entry._tag === workflowArgument)
      if (!definition) return yield* Effect.fail(new Error("Workflow definition unavailable"))
      return yield* workflowCommand === "cancel"
        ? definition.interrupt(workflowSecondArgument)
        : definition.poll(workflowSecondArgument)
    }),
  )
  console.log(JSON.stringify(result ?? { ok: true }, null, 2))
} catch {
  console.error("Workflow command failed. Check arguments, state, and database availability.")
  process.exitCode = 1
} finally {
  await workflowOperatorRuntime.dispose()
}
