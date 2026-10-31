import { networkInterfaces } from "node:os"

import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"
import { Config, Effect, Layer, Option, Result, Schema } from "effect"
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

function getAutoRunnerHost(): string {
  const addresses = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter(({ address, internal }) => {
      const ip = NetAddress.ipFromString(address)
      return (
        !internal &&
        Result.isSuccess(ip) &&
        (NetAddress.isIpv4Address(ip.success)
          ? NetAddress.isPrivate(ip.success)
          : NetAddress.isUniqueLocal(ip.success))
      )
    })
  return (addresses.find(({ family }) => family === "IPv6") ?? addresses[0])?.address ?? "127.0.0.1"
}

/** Auto prefers private IPv6, then private IPv4, falling back to loopback. */
export const clusterRunnerSettings = Effect.gen(function* () {
  const configuredHost = yield* Config.String("CLUSTER_RUNNER_HOST").pipe(
    Config.withDefault("auto"),
  )
  const host = configuredHost === "auto" ? getAutoRunnerHost() : configuredHost
  const port = yield* Config.schema(Schema.Port, "CLUSTER_RUNNER_PORT").pipe(Config.withDefault(0))
  const address = NetAddress.ipFromString(host)
  if (Result.isSuccess(address) && NetAddress.isUnspecified(address.success)) {
    return yield* new ClusterRunnerSettingsInvalid()
  }
  return { host, port }
})

export function clusterRunnerLayer(settings: Effect.Success<typeof clusterRunnerSettings>) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const server = yield* BunHttpServer.make({
        hostname: settings.host,
        port: settings.port,
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
          BunHttpClient.layer,
          RpcSerialization.layerNdjson,
        ]),
        Layer.provideMerge(SqlMessageStorage.layerWith({ prefix: "effect_cluster" })),
        Layer.provide(SqlRunnerStorage.layerWith({ prefix: "effect_cluster" })),
        Layer.provideMerge([config, BunCrypto.layer]),
      )
      return ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(transport))
    }),
  )
}
