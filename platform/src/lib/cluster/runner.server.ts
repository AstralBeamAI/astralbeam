import * as DenoCrypto from "@effect/platform-deno/DenoCrypto"
import * as DenoHttpClient from "@effect/platform-deno/DenoHttpClient"
import * as DenoHttpServer from "@effect/platform-deno/DenoHttpServer"
import { Config, Effect, Layer, Option, Result } from "effect"
import {
  ClusterWorkflowEngine,
  HttpRunner,
  RunnerAddress,
  RunnerHealth,
  Runners,
  ShardingConfig,
  SqlMessageStorage,
  SqlRunnerStorage,
} from "effect/cluster"
import { HttpServer } from "effect/http"
import { NetAddress } from "effect/net"
import { RpcSerialization } from "effect/rpc"

import { ClusterRunnerSettingsInvalid } from "./errors.ts"

/** The runner's advertised and listening addresses, read from the environment only. */
export const clusterRunnerSettings = Effect.gen(function* () {
  const host = yield* Config.String("CLUSTER_RUNNER_HOST").pipe(Config.withDefault("127.0.0.1"))
  const port = yield* Config.Int("CLUSTER_RUNNER_PORT").pipe(Config.withDefault(0))
  const listenHost = yield* Config.String("CLUSTER_RUNNER_LISTEN_HOST").pipe(
    Config.withDefault(host),
  )
  const address = NetAddress.ipFromString(host)
  if (
    port < 0 ||
    port > 65535 ||
    !host ||
    (Result.isSuccess(address) && NetAddress.isUnspecified(address.success))
  ) {
    return yield* new ClusterRunnerSettingsInvalid()
  }
  return { host, port, listenHost }
})

export function clusterRunnerLayer(settings: Effect.Success<typeof clusterRunnerSettings>) {
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
