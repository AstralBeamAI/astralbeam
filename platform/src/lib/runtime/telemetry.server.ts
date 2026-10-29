import process from "node:process"

import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import { getBooleanFromEnv, parseKeyPairsIntoRecord } from "@opentelemetry/core"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import {
  BatchSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { ConfigProvider, Effect, Layer } from "effect"

import { Config } from "@/lib/config/config"
import { otlpLoggerLayer } from "./logging.server.ts"
import { requestTracingLayer } from "./tracing-context.server.ts"

/** Content capture off does not prevent SDKs from attaching raw errors or SQL statements. */
// https://github.com/Effect-TS/effect/blob/main/packages/opentelemetry/src/OtelTracer.ts
export function makeTracingProcessor(exporter: SpanExporter): SpanProcessor {
  const batch = new BatchSpanProcessor(exporter)
  return {
    onStart: () => {},
    onEnd(span) {
      for (const event of span.events) {
        const type = event.name === "exception" ? event.attributes?.["exception.type"] : undefined
        if (typeof type === "string") span.attributes["error.type"] = type
      }
      delete span.attributes["db.query.text"]
      delete span.attributes["url.full"]
      delete span.attributes["url.path"]
      delete span.attributes["url.query"]
      span.events.length = 0
      delete span.status.message
      batch.onEnd(span)
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
    const headers = parseKeyPairsIntoRecord(values.otel_exporter_otlp_headers ?? "")
    const baseUrl = `${endpoint}${endpoint.endsWith("/") ? "" : "/"}v1/`
    return Layer.mergeAll(
      requestTracingLayer.pipe(
        Layer.provideMerge(
          NodeSdk.layer(() => ({
            spanProcessor: makeTracingProcessor(
              new OTLPTraceExporter({
                // The constructor takes a full signal URL, while base endpoints append the signal path.
                // https://opentelemetry.io/docs/specs/otel/protocol/exporter/#endpoint-urls-for-otlphttp
                url: `${baseUrl}traces`,
                headers: {
                  ...headers,
                  ...parseKeyPairsIntoRecord(values.otel_exporter_otlp_traces_headers ?? ""),
                },
              }),
            ),
          })),
        ),
      ),
      values.otel_logs_exporter === "otlp"
        ? otlpLoggerLayer({ url: `${baseUrl}logs`, headers }).pipe(
            Layer.provide(BunHttpClient.layer),
          )
        : Layer.empty,
    ).pipe(
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
