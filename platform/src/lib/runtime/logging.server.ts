import process from "node:process"
import * as OtelTracer from "@effect/opentelemetry/OtelTracer"
import { context as otelContext, isSpanContextValid, trace } from "@opentelemetry/api"

import {
  Array,
  Config,
  ConfigProvider,
  Context,
  Effect,
  Formatter,
  Layer,
  Logger,
  References,
  Tracer,
} from "effect"
import { OtlpExporter, OtlpLogger, OtlpSerialization } from "effect/observability"

import { redactValue } from "@/lib/redaction"
import { getRequestTelemetryAttributes } from "./tracing-context.server.ts"

// Nitro and SSR load separate module copies. Forward their synchronous logs to one scoped exporter.
const telemetryLoggersKey = Symbol.for("platform.telemetryLoggers")
const telemetryLoggers = ((
  globalThis as typeof globalThis & {
    [telemetryLoggersKey]?: Set<Logger.Logger<unknown, void>>
  }
)[telemetryLoggersKey] ??= new Set())

// Keep Effect's cause rendering intact and map only the record fields to ECS.
// https://www.elastic.co/docs/reference/ecs/logging/intro
const ecsLogger = Logger.formatStructured.pipe(
  // Normalize with Effect, then mask credentials before message arguments become a single string.
  Logger.map(redactValue),
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
      "process.pid": process.pid,
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

/** Keep one scoped forwarding pipeline available to Nitro and fallback failures. */
export const telemetryLoggerLayer = (
  options: Parameters<typeof OtlpLogger.make>[0] | undefined,
  nativeLogger?: Logger.Logger<unknown, void>,
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const otlp = options ? yield* OtlpLogger.make(options) : undefined
      const logger = Logger.make((options) => {
        otlp?.log(options)
        nativeLogger?.log(options)
      })
      yield* Effect.acquireRelease(
        Effect.sync(() => telemetryLoggers.add(logger)),
        () => Effect.sync(() => telemetryLoggers.delete(logger)),
      )
    }),
  ).pipe(
    Layer.provide(OtlpExporter.layerFlusher),
    Layer.updateService(OtlpSerialization.OtlpSerialization, (serialization) => ({
      ...serialization,
      logs: (data) => serialization.logs(redactValue(data)),
    })),
    Layer.provide(OtlpSerialization.layerProtobuf),
  )

export const serverLoggerLayer = Layer.mergeAll(
  Logger.layer([
    ecsLogger,
    Logger.make((options) => {
      const logger = telemetryLoggers.values().next().value
      if (!logger) return
      const { fiber } = options
      const context = fiber.context
      const annotations = redactValue({
        ...getRequestTelemetryAttributes(),
        ...fiber.getRef(References.CurrentLogAnnotations),
      })
      // Native OTLP formatting stringifies objects. Redact messages and annotations before it does.
      // Emission is synchronous, so restore the context before any other logger or Effect runs.
      fiber.setContext(Context.add(context, References.CurrentLogAnnotations, annotations))
      const active = trace.getSpanContext(otelContext.active())
      if (
        (!fiber.cache.span || fiber.getRef(Tracer.Tracer) === Tracer.nativeTracer) &&
        active &&
        isSpanContextValid(active)
      ) {
        fiber.setContext(
          Context.add(fiber.context, Tracer.ParentSpan, OtelTracer.makeExternalSpan(active)),
        )
      }
      try {
        logger.log({ ...options, message: redactValue(options.message) })
      } finally {
        fiber.setContext(context)
      }
    }),
  ]),
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
