import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, References } from "effect"
import { TestConsole } from "effect/testing"

import { serverLoggerLayer } from "./logging.server.ts"

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

  it.effect("preserves native causes and correlation when they contain no credentials", () =>
    Effect.gen(function* () {
      const cause = Cause.die(
        new Error("Connection refused\nretry after checking the database", {
          cause: new Error("ECONNREFUSED"),
        }),
      )
      yield* Effect.logError("Request failed", cause).pipe(
        Effect.annotateLogs({ requestId: "request-123", referenceId: "reference-123" }),
        Effect.provide(serverLoggerLayer),
      )
      const lines = yield* TestConsole.logLines
      assert.strictEqual(lines.length, 1)
      const record = JSON.parse(String(lines[0])) as Record<string, unknown>
      assert.strictEqual(record["error.stack_trace"], Cause.pretty(cause))
      assert.strictEqual(record["http.request.id"], "request-123")
      assert.deepStrictEqual(record.astralbeam, { referenceId: "reference-123" })
    }).pipe(Effect.provide(TestConsole.layer)),
  )
})
