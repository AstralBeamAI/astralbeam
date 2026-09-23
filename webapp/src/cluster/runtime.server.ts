import * as DenoClusterHttp from "@effect/platform-deno/DenoClusterHttp"
import { Effect, Layer, Option } from "effect"
import { ClusterWorkflowEngine, RunnerAddress, ShardingConfig } from "effect/unstable/cluster"
import { clusterStorageLayer } from "./storage.server.ts"

function clusterLayer(
  config: Partial<ShardingConfig.ShardingConfig["Service"]>,
  clientOnly = false,
) {
  const shardingConfig = { ...config, shardLockDisableAdvisory: true }
  return ClusterWorkflowEngine.layer.pipe(
    Layer.provideMerge(
      DenoClusterHttp.layer({
        transport: "http",
        serialization: "ndjson",
        storage: "byo",
        clientOnly,
        shardingConfig,
      }).pipe(Layer.provideMerge(clusterStorageLayer(shardingConfig))),
    ),
  )
}

export const clusterClientLayer = clusterLayer({ runnerAddress: Option.none() }, true)

export function clusterRunnerLayer(options: {
  host: string
  port: number
  listenHost: string
  shardingConfig?: Partial<ShardingConfig.ShardingConfig["Service"]>
}) {
  return Layer.effectDiscard(
    Effect.logInfo(`Cluster runner listening at ${options.host}:${options.port}`),
  ).pipe(
    Layer.provideMerge(
      clusterLayer({
        ...options.shardingConfig,
        runnerAddress: Option.some(RunnerAddress.make(options.host, options.port)),
        runnerListenAddress: Option.some(RunnerAddress.make(options.listenHost, options.port)),
      }),
    ),
  )
}
