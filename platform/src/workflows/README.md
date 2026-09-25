# Durable workflows

Durable workflows run background operations through native Effect APIs and a PostgreSQL journal. Named activities provide checkpoints for one operation or a sequence, using the same embedded runner for one process or multiple replicas.

The production registry is empty. Product workflows, public submission endpoints, an operator CLI, scheduling and retention are outside this foundation.

## Architecture

The [embedded cluster runtime](../cluster/README.md) owns private runner communication, PostgreSQL persistence, shard leases, and process lifecycle. This directory owns workflow definitions and [handler registration](registry.server.ts). `ClusterWorkflowEngine` connects the native workflow APIs to that infrastructure.

## Define and register a workflow

1. Define a versioned workflow in a `.server.ts` module with payload, success, and error schemas. Use immutable Organization UUIDs and resource IDs for organization-owned operations. Derive the idempotency key from stable domain identity.
2. Implement the workflow with `.toLayer`. Put external operations inside named `Activity.make` steps with serializable results and typed failures. Yield Effects directly inside the handler.
3. Import the handler layer into `registry.server.ts` and include it in `registeredWorkflowLayers`, using `Layer.mergeAll` for multiple handlers. Provide the application services each handler requires. The runtime supplies the workflow engine and shared SQL client.

This schematic definition assumes an application-provided `performResourceOperation` Effect that returns a string. Supply its real error schema if the operation has typed failures and provide any services it requires.

```ts
import { Effect, Schema } from "effect"
import { Activity, Workflow } from "effect/unstable/workflow"

export const resourceOperationWorkflow = Workflow.make("ResourceOperation/v1", {
  payload: {
    organizationId: Schema.String,
    resourceId: Schema.String,
    operationId: Schema.String,
  },
  success: Schema.String,
  idempotencyKey: ({ organizationId, resourceId, operationId }) =>
    `${organizationId}:${resourceId}:${operationId}`,
})

export const resourceOperationWorkflowLayer = resourceOperationWorkflow.toLayer((payload) =>
  Activity.make({
    name: "PerformResourceOperation",
    success: Schema.String,
    execute: performResourceOperation(payload),
  }),
)
```

Registration makes a handler available. It does not submit an execution. Keep workflow names, payload schemas, activity names, and step ordering compatible with persisted executions. Introduce a new workflow version when those contracts change and retain old handlers until their executions finish.

## Submit and inspect

Use the original workflow definition to submit and inspect executions. Within an Effect that has `WorkflowEngine` available, native submission looks like this:

```ts
const submitResourceOperation = Effect.gen(function* () {
  const executionId = yield* resourceOperationWorkflow.execute(
    { organizationId, resourceId, operationId },
    { discard: true },
  )
  return { executionId, result: yield* resourceOperationWorkflow.poll(executionId) }
})
```

Both submission modes persist requests. `discard: true` returns the execution ID without waiting for completion. Durability still requires transaction commit. Polling returns an `Option` of the native workflow result. Inspect suspended versus complete results and the completed `Exit` to distinguish success from failure. An absent result is not proof of completion.

The first producer must provide `WorkflowEngine` and authorize submission at a server-only framework boundary. `runDatabaseEffect` supplies only database services. Reuse the managed runtime instead of constructing a runner per request.

Use the definition's `interrupt(executionId)` for cooperative cancellation and `resume(executionId)` for suspended work. Cancellation cannot undo completed external effects. Resumption does not create a fresh execution after terminal failure.

## Submit with a business transaction

When a business change requires a follow-up workflow, write both in the same native Effect `SqlClient.withTransaction`. Committing the business write first and submitting afterward leaves a crash window where the business change survives but its follow-up is lost.

This future producer pattern assumes an application-defined `saveBusinessChange` Effect. Both operations must use the same native Effect SQL client and transaction context. Construct the engine or producer layer outside the transaction and provide it at the server boundary.

```ts
import { SqlClient } from "effect/unstable/sql"

const submitResourceChange = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* saveBusinessChange
      return yield* resourceOperationWorkflow.execute(
        { organizationId, resourceId, operationId },
        { discard: true },
      )
    }),
  )
})
```

Return the execution ID only after the transaction commits. Use `discard: true` to avoid waiting for execution of an uncommitted request.

Commit persists the business write and workflow request together. Rollback persists neither, without affecting an execution previously submitted under the same key. The separate Promise/Better Auth pool cannot participate, even if its calls are wrapped in Effects. Atomic submission does not guarantee eventual success or exactly-once external execution.

## Identity and recovery

Execution identity derives from the workflow name and `idempotencyKey(payload)`. Reusing the key targets the existing execution while its journal remains stored, without updating its input. Use a new operation ID for an intentional new execution.

Committed workflows can recover after a caller disconnects or crashes, but the caller's Promise and HTTP connection cannot resume in another process. Reattach using the original definition, payload and key, or poll with the saved execution ID.

`effect_cluster_messages` stores workflow, activity and other cluster requests. `effect_cluster_replies` stores results and outcomes. Replay reuses completed activity results, but a crash between an external operation and persisting its result can repeat that operation. Use provider idempotency keys or domain uniqueness constraints. Use a domain operation ID when deduplication must also span explicit workflow reruns.

## Waits and handler policies

Use `DurableClock.sleep` for persisted delays and `DurableDeferred` for external completion signals. Short timers can remain in memory below their configured threshold. Set `inMemoryThreshold: 0` when even a short delay must survive a restart. Define retry, timeout, and concurrency policies explicitly for each operation using native Effect APIs. Retry only failures that the operation can safely repeat.

Organization-owned workflows carry immutable Organization UUIDs in their payload and execution identity. Include Tenant UUIDs where applicable. Keys establish identity, not authorization. Authorize submissions and external signals, and scope handler database operations to the relevant organization and resources. System-wide workflows need no artificial organization.

Resolve credentials when an activity executes. Prefer resource IDs over secrets, request objects, or large attachments in persisted payloads and results. Journal entries remain until an explicit retention policy is implemented.

## Operation

See the [cluster guide](../cluster/README.md) for storage migrations, readiness and recovery, private replica addresses, and PgBouncer configuration.

## References

- [Workflow](https://effect.website/docs/v4/api/effect/unstable/workflow/Workflow/) defines workflows, execution identity, submission, polling, cancellation, and resumption.
- [Activity](https://effect.website/docs/v4/api/effect/unstable/workflow/Activity/) provides named durable checkpoints.
- [DurableClock](https://effect.website/docs/v4/api/effect/unstable/workflow/DurableClock/) and [DurableDeferred](https://effect.website/docs/v4/api/effect/unstable/workflow/DurableDeferred/) provide waits and completion signals.
- [ClusterWorkflowEngine](https://effect.website/docs/v4/api/effect/unstable/cluster/ClusterWorkflowEngine/) implements workflow execution through cluster entities.
- [SqlMessageStorage](https://effect.website/docs/v4/api/effect/unstable/cluster/SqlMessageStorage/) and [SqlRunnerStorage](https://effect.website/docs/v4/api/effect/unstable/cluster/SqlRunnerStorage/) document persistence and migration behavior.

Consult the installed effect-ts APIs when implementing workflows because upstream documentation and default branches can evolve.
