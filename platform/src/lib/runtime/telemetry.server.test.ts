import { assert, it } from "@effect/vitest"
import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import * as OtelTracer from "@effect/opentelemetry/OtelTracer"
import * as Resource from "@effect/opentelemetry/Resource"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import { SpanStatusCode } from "@opentelemetry/api"
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { Cause, Effect, Option } from "effect"
import { TestConsole } from "effect/testing"
import { afterEach, vi } from "vitest"

import { Config } from "@/lib/config/config"
import { makeTracingProcessor, telemetryLayer } from "./telemetry.server.ts"
import {
  getHttpServerSpan,
  getRequestTelemetryAttributes,
  requestTracingLayer,
  traceHttpRequest,
} from "./tracing-context.server.ts"
import { reportFailure } from "./failure-report.server.ts"
import { serverLoggerLayer, telemetryLoggerLayer } from "./logging.server.ts"
import {
  getPostHogClient,
  mapPostHogAttributes,
  posthogClientLayer,
  posthogErrorLogger,
  posthogOptionsFromValues,
  withPostHogContext,
} from "./posthog.server.ts"

afterEach(() => vi.unstubAllEnvs())

it.effect("keeps the runtime available when telemetry configuration cannot be loaded", () => {
  vi.stubEnv("OTEL_SDK_DISABLED", "false")
  return Effect.gen(function* () {
    assert.isTrue(Option.isNone(yield* Effect.serviceOption(OtelTracer.OtelTracer)))
  }).pipe(
    Effect.provide(telemetryLayer),
    Effect.provideService(Config, {
      snapshot: Effect.die(new Error("database unavailable")) as Config["Service"]["snapshot"],
    } as Config["Service"]),
  )
})

it.effect("does not override the configured service name with the application default", () => {
  vi.stubEnv("OTEL_SDK_DISABLED", "false")
  vi.stubEnv("OTEL_SERVICE_NAME", undefined)
  return Effect.gen(function* () {
    assert.strictEqual((yield* Resource.Resource).attributes["service.name"], "configured-service")
    assert.isUndefined(getPostHogClient())
  }).pipe(
    Effect.provide(telemetryLayer),
    Effect.provideService(Config, {
      snapshot: Effect.succeed({
        values: {
          otel_exporter_otlp_endpoint: "http://127.0.0.1:4318",
          otel_exporter_otlp_headers: "Authorization=Bearer other-receiver-token",
          otel_resource_attributes: "service.name=configured-service",
        },
      }),
    } as Config["Service"]),
  )
})

it("isolates concurrent errors, redacts exports, and preserves cancellation and shutdown", async () => {
  vi.stubEnv("OTEL_SDK_DISABLED", "false")
  const exporter = new InMemorySpanExporter()
  const original = new InMemorySpanExporter()
  const failure = Cause.die(
    new Error("password=opaque-secret", { cause: new Error("api_key=opaque-key") }),
  )
  const events: { distinct_id: string; properties: Record<string, unknown> }[] = []
  const processor = makeTracingProcessor(exporter, mapPostHogAttributes)
  const [spans, rawSpans] = await Effect.runPromise(
    Effect.gen(function* () {
      const recordError = async (id: string) => {
        await traceHttpRequest(
          new Request("https://astralbeam.ai/api/v1/chat", {
            headers: { "X-PostHog-Distinct-Id": id, "X-PostHog-Session-Id": `session-${id}` },
          }),
          async (request) => {
            const span = getHttpServerSpan(request)!
            await Promise.resolve()
            span.setAttribute("db.query.text", "private-sql")
            span.addEvent("discard", { password: "opaque-event" })
            Effect.runSync(reportFailure(id, failure).pipe(Effect.provide(serverLoggerLayer)))
            return new Response()
          },
        )
      }
      yield* Effect.promise(() => Promise.all(["alice", "bob"].map(recordError)))
      yield* reportFailure("cancelled", Cause.interrupt()).pipe(Effect.withSpan("cancelled"))
      yield* Effect.logError("Cancelled", Cause.interrupt())
      yield* Effect.logError("Summary without exception")
      yield* reportFailure("caught", Cause.die("Caught failure")).pipe(Effect.withSpan("caught"))
      yield* Effect.promise(() => processor.forceFlush())
      return [exporter.getFinishedSpans(), original.getFinishedSpans()] as const
    }).pipe(
      Effect.provide(telemetryLoggerLayer(undefined, posthogErrorLogger)),
      Effect.provide(BunHttpClient.layer),
      Effect.provide(requestTracingLayer(withPostHogContext)),
      Effect.provide(
        NodeSdk.layer(() => ({
          spanProcessor: [processor, new SimpleSpanProcessor(original)],
        })),
      ),
      Effect.provide(
        posthogClientLayer({
          ...posthogOptionsFromValues({
            otel_exporter_otlp_endpoint: "https://eu.i.posthog.com/i/",
            otel_exporter_otlp_headers: "Authorization=Bearer generic-token",
            otel_exporter_otlp_traces_headers: "authorization=Bearer trace-token",
          })!,
          disableCompression: true,
          fetch: (url, { body }) => {
            assert.strictEqual(new URL(url).hostname, "eu.i.posthog.com")
            assert.isString(body)
            const payload = JSON.parse(body as string) as { api_key: string; batch: typeof events }
            assert.strictEqual(payload.api_key, "trace-token")
            events.push(...payload.batch)
            return Promise.resolve(new Response("{}"))
          },
        }),
      ),
      Effect.provide(serverLoggerLayer),
      Effect.provide(TestConsole.layer),
    ),
  )
  assert.isUndefined(getPostHogClient())
  for (const id of ["alice", "bob"]) {
    const span = spans.find((entry) => entry.attributes["user.id"] === id)!
    const raw = rawSpans.find((entry) => entry.attributes["user.id"] === id)!
    const event = events.find((entry) => entry.distinct_id === id)!
    assert.strictEqual(span.status.code, SpanStatusCode.ERROR)
    assert.include(span.status.message ?? "", "[REDACTED]")
    assert.isUndefined(raw.attributes.posthogDistinctId)
    assert.strictEqual(span.attributes.posthogDistinctId, id)
    assert.strictEqual(span.attributes.$session_id, `session-${id}`)
    assert.strictEqual(event.properties.$session_id, `session-${id}`)
    assert.strictEqual(event.properties.$span_id, span.spanContext().spanId)
    assert.strictEqual(event.properties.$trace_id, span.spanContext().traceId)
    assert.strictEqual(span.events.length, 1)
    assert.include(String(span.attributes["error.stack"]), "[REDACTED]")
    assert.notInclude(JSON.stringify([span.attributes, span.events, span.status, event]), "opaque-")
    assert.notInclude(JSON.stringify(span.attributes), "private-sql")
    assert.strictEqual(raw.events.length, 2)
    assert.strictEqual(raw.attributes["db.query.text"], "private-sql")
  }
  assert.strictEqual(
    spans.find((span) => span.name === "caught")!.status.code,
    SpanStatusCode.ERROR,
  )
  const cancelled = spans.find((span) => span.name === "cancelled")!
  assert.strictEqual(cancelled.status.code, SpanStatusCode.OK)
  assert.deepStrictEqual(cancelled.events, [])
  assert.strictEqual(events.length, 3)
})

it.effect("correlates HTTP requests without a provider", () =>
  Effect.promise(async () => {
    await traceHttpRequest(
      new Request("https://astralbeam.ai/api/status", {
        headers: { "X-PostHog-Distinct-Id": "alice", "X-PostHog-Session-Id": "session-alice" },
      }),
      () => {
        assert.isUndefined(getPostHogClient())
        assert.deepStrictEqual(getRequestTelemetryAttributes(), {
          "user.id": "alice",
          "session.id": "session-alice",
        })
        return new Response()
      },
    )
  }).pipe(
    Effect.provide(requestTracingLayer()),
    Effect.provide(
      NodeSdk.layer(() => ({ spanProcessor: new SimpleSpanProcessor(new InMemorySpanExporter()) })),
    ),
  ),
)
