import process from "node:process"

import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import { parseKeyPairsIntoRecord } from "@opentelemetry/core"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import {
  BatchSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { ConfigProvider, Effect, Layer } from "effect"

import { Config } from "@/lib/config/config"

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

// NodeSdk owns scoped flush/shutdown. Configuration is captured once, so changes need a restart.
// https://effect.website/docs/v4/observability/tracing
export const tracingLayer = Layer.unwrap(
  Effect.gen(function* () {
    // An explicit disable also avoids reading database-backed settings during bootstrap.
    if (process.env.OTEL_SDK_DISABLED === "true") return NodeSdk.layerEmpty
    const { values } = yield* (yield* Config).snapshot
    // Let the exporter resolve generic and traces-specific environment overrides itself.
    const environmentEndpoint =
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    const environmentHeaders =
      process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS || process.env.OTEL_EXPORTER_OTLP_HEADERS
    const endpoint = environmentEndpoint || values.otel_exporter_otlp_traces_endpoint
    return NodeSdk.layer(() => ({
      resource: { serviceName: "astralbeam-platform" },
      spanProcessor:
        values.otel_sdk_disabled === "true" || !endpoint
          ? []
          : makeTracingProcessor(
              new OTLPTraceExporter({
                ...(!environmentEndpoint ? { url: endpoint } : {}),
                ...(!environmentHeaders && values.otel_exporter_otlp_traces_headers
                  ? { headers: parseKeyPairsIntoRecord(values.otel_exporter_otlp_traces_headers) }
                  : {}),
              }),
            ),
    })).pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnvRecord({
            ...process.env,
            OTEL_RESOURCE_ATTRIBUTES: values.otel_resource_attributes ?? "",
          }),
        ),
      ),
    )
  }),
)
