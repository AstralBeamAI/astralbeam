import { assert, it } from "@effect/vitest"
import { Cause, Effect, Layer, References } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestConsole } from "effect/testing"

import { telemetryLoggerLayer, serverLoggerLayer } from "./logging.server.ts"

it.effect("redacts console paths, causes, provider messages and nested metadata", () =>
  Effect.gen(function* () {
    const platformSecret = "aB".repeat(32)
    yield* Effect.logError(
      "Database connection failed",
      Cause.die(new Error("connect postgres://user:database-password@db/app")),
    )
    yield* Effect.logWarning("Provider failed", {
      message:
        "Incorrect API key provided: sk-provider-secret****; Bearer opaque-bearer; ghp_examplegithubcredential",
      authorization: "Bearer opaque-authorization",
      nested: { apiKey: "opaque-api-key", password: "opaque-password" },
      url: "https://api.example/run?api_key=opaque-query-key",
      credentials: "opaque-credentials",
      callback: "https://astralbeam.ai/auth/callback?code=opaque-oauth-code&utm_source=blog",
      fullPlatformKey: `key_01990a5d-ac96-774b-b942-6b13c85384ca_01990a5d-ac96-774b-b942-6b13c85384c9_abo_${platformSecret}`,
      inlineCredentials: `password="opaque double-quoted password"; secret='opaque single-quoted secret'; note=ordinary`,
    })
    const lines = yield* TestConsole.logLines
    const output = lines.map(String).join("\n")
    assert.strictEqual(
      (JSON.parse(String(lines[0])) as Record<string, unknown>)["url.path"],
      "/api/auth/reset-password/[REDACTED]",
    )
    for (const secret of [
      "opaque-reset-token",
      "database-password",
      "sk-provider-secret",
      "opaque-authorization",
      "opaque-bearer",
      "opaque-api-key",
      "opaque-password",
      "opaque-query-key",
      "ghp_examplegithubcredential",
      "opaque-credentials",
      "opaque-oauth-code",
      platformSecret,
      "double-quoted password",
      "single-quoted secret",
    ])
      assert.notInclude(output, secret)
    assert.include(output, "postgres://user:[REDACTED]@db/app")
    assert.include(output, "Incorrect API key provided:")
    assert.include(output, "Database connection failed")
    assert.include(output, "utm_source=blog")
    assert.include(output, "note=ordinary")
  }).pipe(
    Effect.annotateLogs({ path: "/api/auth/reset-password/opaque-reset-token" }),
    Effect.provide(serverLoggerLayer),
    Effect.provide(TestConsole.layer),
  ),
)

it.effect("redacts shipped request/error logs and replaces a closed exporter", () =>
  Effect.gen(function* () {
    const batches: string[] = []
    const client = HttpClient.make((request) => {
      assert(request.body._tag === "Uint8Array")
      batches.push(new TextDecoder().decode(request.body.body))
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}")))
    })
    const exporter = telemetryLoggerLayer({
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
      yield* Effect.logError("Nested failure", Cause.die("Nested")).pipe(Effect.provide(exporter))
      yield* Effect.logError(
        "Provider failed",
        Cause.die(new Error("Bearer opaque-bearer; password=opaque-inline-password")),
        {
          password: "opaque-password message-secret-tail",
          nested: { credentials: "opaque-credentials" },
        },
      )
      assert.deepStrictEqual((yield* References.CurrentLogAnnotations).metadata, {
        password: "opaque-annotation annotation-secret-tail",
      })
    }).pipe(
      Effect.annotateLogs({
        apiKey: "opaque-api-key",
        metadata: { password: "opaque-annotation annotation-secret-tail" },
      }),
      Effect.provide(exporter),
    )
    const output = batches.join("")
    assert.strictEqual(output.split("Nested failure").length - 1, 1)
    assert.notInclude(output, "opaque-")
    assert.notInclude(output, "secret-tail")
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
