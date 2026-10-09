import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"

import type { ChatModelConfiguration } from "./model-providers.server.ts"
import { testProviderModel } from "./test-model.server.ts"

const configuration: ChatModelConfiguration = {
  providerId: "provider-id",
  providerName: "Test provider",
  providerType: "openai",
  api: "chat-completions",
  baseUrl: "https://provider.example/v1",
  apiKey: "sk-private-key",
  modelId: "saved-model",
  outputCap: 1024,
  fetch,
}

function textResponse(text = "OK", finish: string | null = "stop", api = configuration.api) {
  const events: (Record<string, unknown> & { type?: string })[] =
    api === "responses"
      ? [
          { type: "response.output_text.delta", delta: text },
          { type: "response.completed", response: { id: "r1", status: "completed", output: [] } },
        ]
      : api === "anthropic-messages"
        ? [
            {
              type: "message_start",
              message: {
                id: "m1",
                role: "assistant",
                content: [],
                usage: { input_tokens: 1, output_tokens: 0 },
              },
            },
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
            { type: "content_block_stop", index: 0 },
            {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
              usage: { output_tokens: 1 },
            },
            { type: "message_stop" },
          ]
        : [{ choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] }]
  return new Response(
    events
      .map((event) => `event: ${event.type ?? "message"}\ndata: ${JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  )
}

describe("testProviderModel", () => {
  it.effect("uses each actual adapter with a bounded text request and returns no model text", () =>
    Effect.gen(function* () {
      for (const [providerType, api, tokenField] of [
        ["openai", "chat-completions", "max_tokens"],
        ["openrouter", "chat-completions", "max_tokens"],
        ["openai", "responses", "max_output_tokens"],
        ["anthropic", "anthropic-messages", "max_tokens"],
      ] as const) {
        let request: Record<string, unknown> = {}
        assert.isUndefined(
          yield* testProviderModel({
            ...configuration,
            api,
            providerType,
            fetch: (_input, init) => {
              request = JSON.parse(init?.body as string) as Record<string, unknown>
              return Promise.resolve(textResponse("OK", "stop", api))
            },
          }),
        )
        assert.strictEqual(request.model, "saved-model")
        assert.strictEqual(request[tokenField], 1024)
        assert.notProperty(request, "max_completion_tokens")
        assert.deepEqual(request.tools ?? [], [])
      }
    }),
  )

  it.effect("classifies HTTP failures safely without reading provider diagnostics", () =>
    Effect.gen(function* () {
      for (const [api, status, reason] of [
        ["chat-completions", 401, "credentials"],
        ["responses", 401, "credentials"],
        ["anthropic-messages", 401, "credentials"],
        ["chat-completions", 402, "allowance"],
        ["chat-completions", 404, "model"],
        ["chat-completions", 400, "configuration"],
        ["chat-completions", 429, "allowance"],
        ["chat-completions", 500, "network"],
        ["chat-completions", 0, "network"],
      ] as const) {
        const failed = yield* testProviderModel({
          ...configuration,
          api,
          providerType: api === "anthropic-messages" ? "anthropic" : "openai",
          fetch: () =>
            status
              ? Promise.resolve(
                  Response.json(
                    { error: { message: "private-provider-diagnostic sk-private-key" } },
                    { status, headers: { "retry-after-ms": "1" } },
                  ),
                )
              : Promise.reject(new Error("private-provider-diagnostic sk-private-key")),
        }).pipe(Effect.flip)
        assert.strictEqual(failed.reason, reason)
        assert.notInclude(JSON.stringify(failed), "private-provider-diagnostic")
        assert.notInclude(JSON.stringify(failed), configuration.apiKey)
      }
    }),
  )

  it.effect("rejects truncated and oversized provider responses", () =>
    Effect.gen(function* () {
      for (const response of [
        textResponse("Partial text", "length"),
        textResponse("Partial text", null),
        new Response(" ".repeat(256 * 1024 + 1)),
      ]) {
        const failed = yield* testProviderModel({
          ...configuration,
          fetch: () => Promise.resolve(response),
        }).pipe(Effect.flip)
        assert.strictEqual(failed.reason, "empty")
      }
    }),
  )

  it.effect("aborts the provider request on timeout and interruption", () =>
    Effect.gen(function* () {
      for (const end of ["timeout", "interrupt"] as const) {
        const started = yield* Deferred.make<AbortSignal>()
        const fiber = yield* testProviderModel({
          ...configuration,
          fetch: (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("Aborted", "AbortError")),
                { once: true },
              )
              Deferred.doneUnsafe(started, Effect.succeed(init!.signal!))
            }),
        }).pipe(Effect.flip, Effect.forkChild)
        const signal = yield* Deferred.await(started)
        if (end === "timeout") {
          yield* TestClock.adjust("30 seconds")
          assert.strictEqual((yield* Fiber.join(fiber)).reason, "timeout")
        } else yield* Fiber.interrupt(fiber)
        assert.isTrue(signal.aborted)
      }
    }),
  )
})
