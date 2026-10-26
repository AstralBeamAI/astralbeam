import process from "node:process"

import { Array, Config, ConfigProvider, Effect, Formatter, Layer, Logger, References } from "effect"

// Keep Effect's cause rendering intact and map only the record fields to ECS.
// https://www.elastic.co/docs/reference/ecs/logging/intro
const ecsLogger = Logger.formatStructured.pipe(
  Logger.map(({ timestamp, level, message, cause, annotations }) => {
    const { event, requestId, method, path, status, durationMs, ...attributes } = annotations
    return Formatter.formatJson({
      "@timestamp": timestamp,
      "log.level": level,
      message: Array.ensure(message)
        .map((value) => (typeof value === "string" ? value : Formatter.format(value)))
        .join(" "),
      "ecs.version": "9.5.0",
      "service.name": "astralbeam-platform",
      "event.action": event,
      // ECS durations are integer nanoseconds.
      "event.duration":
        typeof durationMs === "number" ? Math.round(durationMs * 1_000_000) : undefined,
      "http.request.id": requestId ?? undefined,
      "http.request.method": method,
      "http.response.status_code": status,
      "url.path": path,
      "error.stack_trace": cause,
      astralbeam: Object.keys(attributes).length > 0 ? attributes : undefined,
    })
  }),
  Logger.withConsoleLog,
)

export const serverLoggerLayer = Layer.mergeAll(
  Logger.layer([ecsLogger]),
  Layer.effect(
    References.MinimumLogLevel,
    Config.LogLevel("LOG_LEVEL").pipe(
      Config.withDefault("Info"),
      // The default provider lets import.meta.env override process.env, including Vite's values.
      // https://github.com/Effect-TS/effect/blob/main/packages/effect/src/ConfigProvider.ts
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord(process.env),
      ),
      Effect.orDie,
    ),
  ),
)
