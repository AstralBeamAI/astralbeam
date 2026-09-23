# Durable workflows

Use native Effect workflows for background work. A workflow with one named activity handles a single operation. Multiple named activities provide checkpoints for a sequence. Both run through the same embedded [cluster runtime](../cluster/README.md), PostgreSQL journal, and server-only API.

Define a workflow with `Workflow.make`, implement it with `.toLayer`, and register its handler in `registry.server.ts`. The synthetic `system.example/v1` definition in `example.server.ts` demonstrates one activity and an optional scheduled start. No workflow runs merely because it is registered. Keep definition names versioned and retain compatible handlers while their executions remain active.

## Submit and inspect

Native submission returns an execution ID when `discard` is true. Polling and interruption use that ID and the original workflow definition, including its payload, success, and error schemas. Effect caches schemas by workflow name, so do not substitute a schema-incomplete definition.

```ts
import { Effect } from "effect"
import { runDatabaseEffect } from "../db/index.ts"
import { clusterClientLayer } from "../cluster/runtime.server.ts"
import { exampleWorkflow } from "./example.server.ts"

await runDatabaseEffect(
  Effect.gen(function* () {
    const executionId = yield* exampleWorkflow.execute(
      { key: "unique-request-key" },
      { discard: true },
    )
    return { executionId, result: yield* exampleWorkflow.poll(executionId) }
  }).pipe(Effect.provide(clusterClientLayer)),
)
```

For a long-lived producer, compose `clusterClientLayer` once in its existing scope with the shared Effect SQL client. It opens no runner listener or additional database pool.

`workflow.poll(executionId)` returns native `Option<Result>`. An absent result is not proof of completion. A result can be suspended or complete, with an Effect `Exit` carrying success or failure. `workflow.interrupt(executionId)` requests cooperative cancellation, which cannot undo completed external effects. Propagate abort signals through Promise integrations. `workflow.resume` resumes suspended work, not a new execution after terminal failure.

The development operator CLI supports the synthetic example, polling, and interruption. See [local setup](../../../SETUP.md#option-2-run-directly-on-macos) for commands.

## Submit with a business transaction

When a business change requires a follow-up workflow, persist both in one `sql.withTransaction`. Committing the business change first and submitting afterward leaves a crash window where the change survives but its follow-up is lost. The persisted request in `cluster_messages` supplies the durable submission record, so this pattern needs no additional outbox table.

This schematic example assumes an application-defined `saveBusinessChange` Effect and `followUpWorkflow`. The write must use the same Effect SQL client and transaction context as workflow submission. Include immutable organization/resource IDs and a stable operation ID in the workflow payload and idempotency key.

```ts
import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { runDatabaseEffect } from "../db/index.ts"
import { clusterClientLayer } from "../cluster/runtime.server.ts"

const executionId = await runDatabaseEffect(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* saveBusinessChange
        return yield* followUpWorkflow.execute(
          { organizationId, resourceId, operationId },
          { discard: true },
        )
      }),
    )
  }).pipe(Effect.provide(clusterClientLayer)),
)
```

Construct `clusterClientLayer` outside the transaction, as shown above, or reuse an existing producer scope. Use `discard: true` to await durable submission without waiting for workflow completion inside the transaction. Return the execution ID to the HTTP caller only after the transaction commits.

- On commit, the business write and workflow request both persist. A runner can recover the request after a process crash.
- On rollback, neither persists. The [transaction integration test](../../scripts/cluster/runtime.test.ts) checks both outcomes.
- Transactions on the separate Promise/Better Auth pool cannot participate. Wrapping a Promise-based write in an Effect does not move it into the Effect SQL transaction.
- This guarantees atomic submission, not eventual success or exactly-once external effects. Keep external calls inside named activities with idempotency and an explicit failure policy.

## Identity and execution policy

Effect derives execution identity from the workflow name and `idempotencyKey(payload)`. Reusing the same key targets the same execution while its journal remains stored. It does not update input or scheduling, detect conflicting payloads, or create a time-window deduplication policy. Submit input with a fresh key for an explicit rerun. There is no retained-input lookup, retry lineage, generic listing, automatic journal cleanup, or organization-deletion cascade.

Organization-scoped workflows should include immutable organization and applicable tenant UUIDs in their payload and idempotency key. System-wide workflows need no artificial organization. Keys establish execution identity, not authorization. Recheck scope and resource ownership inside handlers. Default sharding distributes executions, so including an organization UUID in a key does not force every workflow for that organization onto one shard.

Put external side effects inside named `Activity.make` boundaries. A crash can repeat an effect before its result is recorded. Use provider idempotency keys or domain uniqueness constraints. `Activity.idempotencyKey` supplies a stable key for an activity across its retries. A fresh workflow execution has a different activity key, so use a domain operation ID when deduplication must span explicit reruns.

Use `Activity.retry` for explicit typed-error retry policy, `DurableClock.sleep` for persisted waits, and `DurableDeferred` for external completion signals. Keep retry delays outside activity bodies. The example uses a zero in-memory threshold so positive scheduled delays persist. There is no implicit retry budget, timeout, or global activity semaphore added by this application. Define these policies where the operation needs them, using native Effect composition.

Journals retain payloads and results indefinitely. Prefer resource IDs over sensitive payloads. Durable transcript storage, streaming, application approvals, recurring business workflows, and product UI remain separate features.

## Upstream contracts

- [Workflow](https://effect.website/docs/v4/api/effect/unstable/workflow/Workflow) owns definitions, execution IDs, submission, polling, interruption, and resumption.
- [Activity](https://effect.website/docs/v4/api/effect/unstable/workflow/Activity) owns named checkpoints and attempt identity.
- [DurableClock](https://effect.website/docs/v4/api/effect/unstable/workflow/DurableClock) and [DurableDeferred](https://effect.website/docs/v4/api/effect/unstable/workflow/DurableDeferred) provide waits and completion signals.
- [ClusterWorkflowEngine](https://effect.website/docs/v4/api/effect/unstable/cluster/ClusterWorkflowEngine) persists workflow operations through cluster entities.

The installed version is rc.117. Use caret ranges for `effect`, `@effect/sql-pg`, `@effect/platform-deno`, and `@effect/vitest`, keep their resolved versions aligned in the lockfile, and inspect the transitive `@effect/platform-node-shared` lock entry during upgrades. Review the SQL migration and storage guard against the installed release. Upstream main may expose different paths and contracts.
