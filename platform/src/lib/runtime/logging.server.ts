import process from "node:process"

import {
  Array,
  Config,
  ConfigProvider,
  Effect,
  Formatter,
  Layer,
  Logger,
  Predicate,
  References,
} from "effect"
import { OtlpExporter, OtlpLogger, OtlpSerialization } from "effect/observability"

const SECRET_LOG_FIELDS =
  "authorization|cookie|set-cookie|password|passwd|secret|credentials?|api[_-]?key|(?:access|refresh)[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|token"
const SECRET_LOG_FIELD = new RegExp(`^(?:${SECRET_LOG_FIELDS})$`, "iu")
const SECRET_LOG_ASSIGNMENT = new RegExp(
  `(\\b(?:${SECRET_LOG_FIELDS})["']?\\s*[:=]\\s*["']?)[^"'&,\\s<>]+`,
  "giu",
)

// Nitro and SSR load separate module copies. Forward their synchronous logs to one scoped exporter.
const otlpLoggersKey = Symbol.for("platform.otlpLoggers")
const otlpLoggers = ((
  globalThis as typeof globalThis & {
    [otlpLoggersKey]?: Set<Logger.Logger<unknown, void>>
  }
)[otlpLoggersKey] ??= new Set())

// Keep Effect's cause rendering intact and map only the record fields to ECS.
// https://www.elastic.co/docs/reference/ecs/logging/intro
const ecsLogger = Logger.formatStructured.pipe(
  // Normalize with Effect, then mask credentials before message arguments become a single string.
  Logger.map(redactLogRecord),
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

function redactLogValue(key: string, value: unknown): unknown {
  if (SECRET_LOG_FIELD.test(key)) return "[REDACTED]"
  // OTLP represents named fields as KeyValue objects rather than JSON property names.
  if (
    Predicate.hasProperty(value, "key") &&
    typeof value.key === "string" &&
    Predicate.hasProperty(value, "value") &&
    SECRET_LOG_FIELD.test(value.key)
  ) {
    return { ...value, value: { stringValue: "[REDACTED]" } }
  }
  if (typeof value !== "string") return value
  // Better Auth puts password-reset credentials in the path, unlike its query-based tokens.
  return value
    .replace(/(\/api\/auth\/reset-password\/)[^/?#\s"']+/gu, "$1[REDACTED]")
    .replace(/(\b[a-z][a-z\d+.-]*:\/\/[^/\s:@]+:)[^/\s@]*@/giu, "$1[REDACTED]@")
    .replace(/\b(Bearer|Basic)\s+[\w.~+/*-]+=*/giu, "$1 [REDACTED]")
    .replace(
      /\b(?:sk-[\w*-]+|(?:gh[pousr]_|github_pat_)\w+|xox[baprs]-[\w-]+|AIza[\w-]{35}|(?:AKIA|ASIA)[A-Z\d]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)/gu,
      "[REDACTED]",
    )
    .replace(SECRET_LOG_ASSIGNMENT, "$1[REDACTED]")
}

function redactLogRecord<A>(record: A): A {
  return JSON.parse(Formatter.formatJson(record), redactLogValue) as A
}

/** Native OTLP batching and finalization, with the same redaction as console output. */
export const otlpLoggerLayer = (options: Parameters<typeof OtlpLogger.make>[0]) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const logger = yield* OtlpLogger.make(options)
      yield* Effect.acquireRelease(
        Effect.sync(() => otlpLoggers.add(logger)),
        () => Effect.sync(() => otlpLoggers.delete(logger)),
      )
    }),
  ).pipe(
    Layer.provide(OtlpExporter.layerFlusher),
    Layer.updateService(OtlpSerialization.OtlpSerialization, (serialization) => ({
      ...serialization,
      logs: (data) => serialization.logs(redactLogRecord(data)),
    })),
    Layer.provide(OtlpSerialization.layerProtobuf),
  )

export const serverLoggerLayer = Layer.mergeAll(
  Logger.layer([
    ecsLogger,
    Logger.make((options) => otlpLoggers.values().next().value?.log(options)),
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
