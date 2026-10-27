import { assert, it } from "@effect/vitest"
import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import * as OtelTracer from "@effect/opentelemetry/OtelTracer"
import * as Resource from "@effect/opentelemetry/Resource"
import { SpanStatusCode } from "@opentelemetry/api"
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base"
import { Effect, Option } from "effect"
import { afterEach, vi } from "vitest"

import { Config } from "@/lib/config/config"
import { makeTracingProcessor, tracingLayer } from "./tracing.server.ts"

afterEach(() => vi.unstubAllEnvs())

it.effect("keeps tracing disabled when only labels and headers are configured", () => {
  vi.stubEnv("OTEL_SDK_DISABLED", "false")
  return Effect.gen(function* () {
    assert.isTrue(Option.isNone(yield* Effect.serviceOption(OtelTracer.OtelTracer)))
  }).pipe(
    Effect.provide(tracingLayer),
    Effect.provideService(Config, {
      snapshot: Effect.succeed({
        values: {
          otel_exporter_otlp_headers: "Authorization=Bearer unused-key",
          otel_resource_attributes:
            "deployment.environment.name=development-hasan,service.instance.id=worktree-test",
        },
      }),
    } as Config["Service"]),
  )
})

it.effect.each([
  ["", undefined, "astralbeam-platform"],
  ["service.name=configured-service", undefined, "configured-service"],
  ["service.name=configured-service", "environment-service", "environment-service"],
] as const)(
  "honors native service-name precedence: %s, %s",
  ([attributes, serviceName, expected]) => {
    vi.stubEnv("OTEL_SDK_DISABLED", "false")
    vi.stubEnv("OTEL_SERVICE_NAME", serviceName)
    return Effect.gen(function* () {
      assert.strictEqual((yield* Resource.Resource).attributes["service.name"], expected)
    }).pipe(
      Effect.provide(tracingLayer),
      Effect.provideService(Config, {
        snapshot: Effect.succeed({
          values: {
            otel_exporter_otlp_endpoint: "http://127.0.0.1:4318",
            otel_resource_attributes: attributes,
          },
        }),
      } as Config["Service"]),
    )
  },
)

it.effect("exports useful failure metadata without content, SQL or raw exceptions", () => {
  const exporter = new InMemorySpanExporter()
  const processor = makeTracingProcessor(exporter)
  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const span = yield* OtelTracer.currentOtelSpan
      span.setAttributes({
        requestId: "request-123",
        "gen_ai.request.model": "fake-model",
        "gen_ai.usage.input_tokens": 7,
        "gen_ai.usage.output_tokens": 3,
        "db.query.text": "select 'private-content'",
        "effect.sql.method": "executeRaw",
        "url.full": "https://example.com/api/auth/reset-password/private-content",
        "url.path": "/api/auth/reset-password/private-content",
        "url.query": "secret=private-content",
        "http.route": "/api/v1/chat",
      })
      span.addEvent("gen_ai.user.message", { content: "private-content" })
      return yield* Effect.die(new Error("private-content"))
    }).pipe(Effect.withSpan("failed.operation"), Effect.exit)
    yield* Effect.promise(() => processor.forceFlush())

    const spans = exporter.getFinishedSpans()
    assert.strictEqual(spans.length, 1)
    assert.deepStrictEqual(spans[0]!.status, { code: SpanStatusCode.ERROR })
    assert.deepStrictEqual(spans[0]!.events, [])
    assert.deepStrictEqual(spans[0]!.attributes, {
      requestId: "request-123",
      "gen_ai.request.model": "fake-model",
      "gen_ai.usage.input_tokens": 7,
      "gen_ai.usage.output_tokens": 3,
      "http.route": "/api/v1/chat",
      "effect.sql.method": "executeRaw",
      "error.type": "Error",
    })
  }).pipe(Effect.provide(NodeSdk.layer(() => ({ spanProcessor: processor }))))
})
