import process from "node:process"

import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import { SpanStatusCode, type Attributes } from "@opentelemetry/api"
import { getBooleanFromEnv, parseKeyPairsIntoRecord } from "@opentelemetry/core"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { ConfigProvider, Effect, identity, Layer } from "effect"

import { Config } from "@/lib/config/config"
import { redactValue } from "@/lib/redaction"
import { telemetryLoggerLayer } from "./logging.server.ts"
import { getRequestTelemetryAttributes, requestTracingLayer } from "./tracing-context.server.ts"
import {
  mapPostHogAttributes,
  posthogAiExporter,
  posthogClientLayer,
  posthogErrorLogger,
  posthogOptionsFromValues,
  withPostHogContext,
} from "./posthog.server.ts"

/** Preserve redacted exception details without SQL or credential-bearing URLs. */
// https://github.com/Effect-TS/effect/blob/main/packages/opentelemetry/src/OtelTracer.ts
export function makeTracingProcessor(
  exporter: SpanExporter,
  mapAttributes: (attributes: Readonly<Attributes>) => Attributes = identity,
): SpanProcessor {
  const batch = new BatchSpanProcessor(exporter)
  return {
    onStart(span, parentContext) {
      span.setAttributes({
        ...getRequestTelemetryAttributes(parentContext),
        ...(span as ReadableSpan).attributes,
      })
    },
    onEnd(span) {
      const attributes = { ...span.attributes }
      const events = span.events.filter((event) => event.name === "exception")
      const exception = events.at(-1)?.attributes
      delete attributes["db.query.text"]
      delete attributes["url.full"]
      delete attributes["url.path"]
      delete attributes["url.query"]
      const status = { ...span.status }
      // Effect marks a caught operation successful on exit. An explicitly reported error still failed.
      if (typeof span.attributes["error.type"] === "string") {
        status.code = SpanStatusCode.ERROR
        const message = exception?.["exception.message"]
        if (typeof message === "string") status.message ??= message
      }
      if (status.code === SpanStatusCode.ERROR) {
        attributes["error.type"] = exception?.["exception.type"] ?? attributes["error.type"]
        attributes["error.message"] ??= exception?.["exception.message"]
        attributes["error.stack"] ??= exception?.["exception.stacktrace"]
      }
      const redacted = redactValue({
        attributes: mapAttributes(attributes),
        events,
        status,
      })
      // Processors share spans. Keep sanitization local to this exporter.
      batch.onEnd(Object.assign(Object.create(span) as ReadableSpan, redacted))
    },
    forceFlush: () => batch.forceFlush(),
    shutdown: () => batch.shutdown(),
  }
}

// Native exporters own scoped flush/shutdown. Configuration is captured once, so changes need a restart.
// https://effect.website/docs/v4/observability/tracing
export const telemetryLayer = Layer.unwrap(
  Effect.gen(function* () {
    // An explicit disable also avoids reading database-backed settings during bootstrap.
    if (getBooleanFromEnv("OTEL_SDK_DISABLED")) return NodeSdk.layerEmpty
    // Optional telemetry must not prevent public routes or operator recovery while storage is down.
    const snapshot = yield* (yield* Config).snapshot.pipe(
      Effect.catchDefect(() =>
        Effect.logWarning("Telemetry disabled because configuration is unavailable").pipe(
          Effect.as(undefined),
        ),
      ),
    )
    if (!snapshot) return NodeSdk.layerEmpty
    const { values } = snapshot
    const endpoint = values.otel_exporter_otlp_endpoint
    if (values.otel_sdk_disabled === "true" || !endpoint) return NodeSdk.layerEmpty
    const posthogOptions = posthogOptionsFromValues(values)
    const headers = parseKeyPairsIntoRecord(values.otel_exporter_otlp_headers ?? "")
    const baseUrl = `${endpoint}${endpoint.endsWith("/") ? "" : "/"}v1/`
    return Layer.mergeAll(
      requestTracingLayer(posthogOptions ? withPostHogContext : undefined).pipe(
        Layer.provideMerge(
          NodeSdk.layer(() => ({
            spanProcessor: [
              new OTLPTraceExporter({
                // The constructor takes a full signal URL, while base endpoints append the signal path.
                // https://opentelemetry.io/docs/specs/otel/protocol/exporter/#endpoint-urls-for-otlphttp
                url: `${baseUrl}traces`,
                headers: {
                  ...headers,
                  ...parseKeyPairsIntoRecord(values.otel_exporter_otlp_traces_headers ?? ""),
                },
              }),
              ...(posthogOptions ? [posthogAiExporter(posthogOptions)] : []),
            ].map((exporter) =>
              makeTracingProcessor(exporter, posthogOptions ? mapPostHogAttributes : undefined),
            ),
          })),
        ),
      ),
      values.otel_logs_exporter === "otlp" || posthogOptions
        ? telemetryLoggerLayer(
            values.otel_logs_exporter === "otlp" ? { url: `${baseUrl}logs`, headers } : undefined,
            posthogOptions ? posthogErrorLogger : undefined,
          ).pipe(Layer.provide(BunHttpClient.layer))
        : Layer.empty,
    ).pipe(
      Layer.provide(posthogOptions ? posthogClientLayer(posthogOptions) : Layer.empty),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnvRecord({
            ...process.env,
            // Native parsing lets configured attributes and OTEL_SERVICE_NAME override this default.
            OTEL_RESOURCE_ATTRIBUTES: `service.name=astralbeam-platform,${values.otel_resource_attributes ?? ""}`,
          }),
        ),
      ),
    )
  }),
)
