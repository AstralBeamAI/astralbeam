import process from "node:process"

import * as DenoCrypto from "@effect/platform-deno/DenoCrypto"
import * as DenoHttpClient from "@effect/platform-deno/DenoHttpClient"
import * as DenoHttpServer from "@effect/platform-deno/DenoHttpServer"
import { Effect, Layer, Option, Result } from "effect"
import {
  ClusterWorkflowEngine,
  HttpRunner,
  RunnerAddress,
  RunnerHealth,
  Runners,
  ShardingConfig,
  SqlMessageStorage,
  SqlRunnerStorage,
} from "effect/unstable/cluster"
import { HttpServer } from "effect/unstable/http"
import { NetAddress } from "effect/unstable/net"
import { RpcSerialization } from "effect/unstable/rpc"

export function clusterRunnerSettings() {
  const host = process.env.CLUSTER_RUNNER_HOST ?? "127.0.0.1"
  const portValue = process.env.CLUSTER_RUNNER_PORT ?? "0"
  const port = Number(portValue)
  if (!/^\d+$/u.test(portValue) || port > 65535) {
    throw new Error("CLUSTER_RUNNER_PORT must be an integer between 0 and 65535")
  }
  const address = NetAddress.ipFromString(host)
  if (!host || (Result.isSuccess(address) && NetAddress.isUnspecified(address.success))) {
    throw new Error("CLUSTER_RUNNER_HOST must be a reachable host, not a wildcard")
  }
  return { host, port, listenHost: process.env.CLUSTER_RUNNER_LISTEN_HOST ?? host }
}

export function clusterRunnerLayer(settings: ReturnType<typeof clusterRunnerSettings>) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const server = yield* DenoHttpServer.make({
        hostname: settings.listenHost,
        port: settings.port,
        onListen: () => {},
      })
      if (server.address._tag === "UnixPathAddress") {
        return yield* Effect.die(new Error("Cluster runner requires a TCP listener"))
      }
      const config = ShardingConfig.layer({
        runnerAddress: Option.some(RunnerAddress.make(settings.host, server.address.port)),
        shardLockDisableAdvisory: true,
      })
      const transport = HttpRunner.layerHttp.pipe(
        Layer.provide(
          RunnerHealth.layerPing.pipe(
            Layer.provide(Runners.layerRpc),
            Layer.provide(HttpRunner.layerClientProtocolHttpDefault),
          ),
        ),
        Layer.provide([
          Layer.succeed(HttpServer.HttpServer, server),
          DenoHttpClient.layer,
          RpcSerialization.layerNdjson,
        ]),
        Layer.provideMerge(SqlMessageStorage.layerWith({ prefix: "effect_cluster" })),
        Layer.provide(SqlRunnerStorage.layerWith({ prefix: "effect_cluster" })),
        Layer.provideMerge(config),
        Layer.provideMerge(DenoCrypto.layer),
      )
      return ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(transport))
    }),
  )
}
