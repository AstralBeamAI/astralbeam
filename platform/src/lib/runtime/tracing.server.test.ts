import { assert, it } from "@effect/vitest"
import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import * as OtelTracer from "@effect/opentelemetry/OtelTracer"
import { SpanStatusCode } from "@opentelemetry/api"
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base"
import { Effect } from "effect"

import { makeTracingProcessor } from "./tracing.server.ts"

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
