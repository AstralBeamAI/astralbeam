import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Layer, References } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestConsole } from "effect/testing"

import { otlpLoggerLayer, serverLoggerLayer } from "./logging.server.ts"

describe("ECS credential redaction", () => {
  it.effect("masks password-reset paths in request and response logs", () =>
    Effect.gen(function* () {
      yield* Effect.logDebug("HTTP request started")
      yield* Effect.logInfo("HTTP response ready")
      const lines = yield* TestConsole.logLines
      assert.strictEqual(lines.length, 2)
      for (const line of lines) {
        assert.notInclude(String(line), "opaque-reset-token")
        const record = JSON.parse(String(line)) as Record<string, unknown>
        assert.strictEqual(record["url.path"], "/api/auth/reset-password/[REDACTED]")
      }
    }).pipe(
      Effect.annotateLogs({ path: "/api/auth/reset-password/opaque-reset-token" }),
      Effect.provideService(References.MinimumLogLevel, "Debug"),
      Effect.provide(serverLoggerLayer),
      Effect.provide(TestConsole.layer),
    ),
  )

  it.effect("masks credentials in causes, provider messages and nested metadata", () =>
    Effect.gen(function* () {
      yield* Effect.logError(
        "Database connection failed",
        Cause.die(new Error("connect postgres://user:database-password@db/app")),
      ).pipe(Effect.provide(serverLoggerLayer))
      yield* Effect.logWarning("Provider failed", {
        message:
          "Incorrect API key provided: sk-provider-secret****; Bearer opaque-bearer; ghp_examplegithubcredential",
        authorization: "Bearer opaque-authorization",
        nested: { apiKey: "opaque-api-key", password: "opaque-password" },
        url: "https://api.example/run?api_key=opaque-query-key",
        credentials: "opaque-credentials",
      }).pipe(Effect.provide(serverLoggerLayer))
      const output = (yield* TestConsole.logLines).map(String).join("\n")
      for (const secret of [
        "database-password",
        "sk-provider-secret",
        "opaque-authorization",
        "opaque-bearer",
        "opaque-api-key",
        "opaque-password",
        "opaque-query-key",
        "ghp_examplegithubcredential",
        "opaque-credentials",
      ])
        assert.notInclude(output, secret)
      assert.include(output, "postgres://user:[REDACTED]@db/app")
      assert.include(output, "Incorrect API key provided:")
      assert.include(output, "Database connection failed")
    }).pipe(Effect.provide(TestConsole.layer)),
  )
})

it.effect("redacts shipped request/error logs and replaces a closed exporter", () =>
  Effect.gen(function* () {
    const batches: string[] = []
    const client = HttpClient.make((request) => {
      assert(request.body._tag === "Uint8Array")
      batches.push(new TextDecoder().decode(request.body.body))
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}")))
    })
    const exporter = otlpLoggerLayer({
      url: "http://localhost:4318/v1/logs",
      resource: { serviceName: "logging-test" },
    }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))
    yield* Effect.gen(function* () {
      // Nitro and fallback errors log outside the application's runtime.
      Effect.runSync(
        Effect.logInfo("HTTP response ready").pipe(
          Effect.annotateLogs({
            requestId: "request-export-test",
            path: "/api/auth/reset-password/opaque-reset-token",
          }),
          Effect.provide(serverLoggerLayer),
        ),
      )
      yield* Effect.logError(
        "Provider failed",
        Cause.die(new Error("Bearer opaque-bearer; password=opaque-inline-password")),
        { password: "opaque-password", nested: { credentials: "opaque-credentials" } },
      ).pipe(Effect.annotateLogs({ apiKey: "opaque-api-key" }))
    }).pipe(Effect.provide(exporter))
    const output = batches.join("")
    assert.notInclude(output, "opaque-")
    for (const expected of [
      "HTTP response ready",
      "Provider failed",
      "request-export-test",
      "exception.stacktrace",
      "Bearer [REDACTED]; password=[REDACTED]",
    ])
      assert.include(output, expected)
    const consoleOutput = (yield* TestConsole.logLines).map(String).join("\n")
    assert.include(consoleOutput, "Provider failed")
    assert.notInclude(consoleOutput, "opaque-")
    yield* Effect.logInfo("Replacement exporter").pipe(Effect.provide(exporter))
    assert.include(batches.join(""), "Replacement exporter")
  }).pipe(Effect.provide(serverLoggerLayer), Effect.provide(TestConsole.layer)),
)
