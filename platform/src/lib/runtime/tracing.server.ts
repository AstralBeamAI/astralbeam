import process from "node:process"

import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import {
  BatchSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { ConfigProvider, Layer } from "effect"

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

// NodeSdk owns batching's scoped flush and shutdown. The exporter reads standard OTLP env vars.
// https://effect.website/docs/v4/observability/tracing
export const tracingLayer = NodeSdk.layer(() => ({
  resource: { serviceName: "astralbeam-platform" },
  spanProcessor:
    process.env.OTEL_SDK_DISABLED === "true" ||
    !(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
      ? []
      : makeTracingProcessor(new OTLPTraceExporter()),
})).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(process.env))))
