import { Schema } from "effect"
import { ClusterSchema, Entity } from "effect/unstable/cluster"
import { Rpc } from "effect/unstable/rpc"
import { Workflow } from "effect/unstable/workflow"

export const clusterProbe = Entity.make("ClusterTest/Probe", [
  Rpc.make("increment", {
    payload: { id: Schema.String },
    primaryKey: ({ id }) => id,
    success: Schema.Struct({ value: Schema.Number, pid: Schema.Number }),
  }).annotate(ClusterSchema.Persisted, true),
])

export const clusterRecoveryWorkflow = Workflow.make("ClusterTest/Recovery", {
  payload: { id: Schema.String },
  idempotencyKey: ({ id }) => id,
  success: Schema.String,
})
