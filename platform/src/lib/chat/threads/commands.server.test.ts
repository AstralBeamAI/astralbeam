import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"

import { Agents } from "@/lib/agents/agents.server"
import type { ChatParams } from "../types"
import { ChatThreads, type AdmitInput, type ResolveToolsInput } from "./threads.server"
import { prepareManagedChat, resolveManagedChatTools } from "./commands.server"

const commandOrgId = "019a0000-0000-7000-8000-000000000001"
const commandTenantId = "019a0000-0000-7000-8000-000000000002"
const commandUserId = "019a0000-0000-7000-8000-000000000003"
const commandThreadId = "019a0000-0000-7000-8000-000000000004"
const commandScope = {
  organizationId: commandOrgId,
  tenantId: commandTenantId,
  tenantUserId: commandUserId,
}
const commandParams: ChatParams = {
  threadId: commandThreadId,
  runId: "run",
  messages: [{ id: "input", role: "user", content: "Hello" }],
  tools: [],
  state: undefined,
  context: [],
  aguiContext: [],
  forwardedProps: { clientId: commandUserId },
}

describe("managed conversation commands", () => {
  it.effect("validates uploaded content before accepting input", () => {
    const admitted: AdmitInput[] = []
    let attachmentsEnabled = true
    const layer = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, {} as SqlClient.SqlClient),
      Layer.succeed(Agents, {
        resolveForChat: () => Effect.succeed({ attachmentsEnabled, sandboxProviderId: null }),
      } as unknown as typeof Agents.Service),
      Layer.succeed(ChatThreads, {
        get: () => Effect.succeed({ agentId: commandThreadId }),
        admit: (input: AdmitInput) => {
          admitted.push(input)
          return Effect.succeed({
            thread: { id: commandThreadId, lockVersion: 1 },
            inputMessage: { id: commandUserId },
          })
        },
      } as unknown as typeof ChatThreads.Service),
    )
    return Effect.gen(function* () {
      const input = { scope: commandScope, params: commandParams }
      yield* prepareManagedChat(input)
      for (const source of [
        { type: "url", value: "http://internal.invalid/image", mimeType: "image/png" },
        {
          type: "data",
          value: `${btoa("\x89PNG\r\n\x1a\n" + "x".repeat(30))}!`,
          mimeType: "image/png",
        },
        {
          type: "data",
          value: `data:application/pdf;base64,${btoa("%PDF-1.7" + "x".repeat(30))}!`,
          mimeType: "application/pdf",
        },
      ] as const) {
        const invalid = yield* prepareManagedChat({
          ...input,
          params: {
            ...commandParams,
            messages: [
              {
                id: "upload",
                role: "user",
                content: [
                  { type: source.mimeType === "application/pdf" ? "document" : "image", source },
                ],
              },
            ],
          },
        }).pipe(Effect.result)
        assert.equal(invalid._tag, "Failure")
      }
      attachmentsEnabled = false
      const disabled = yield* prepareManagedChat({
        ...input,
        params: {
          ...commandParams,
          messages: [
            {
              id: "upload",
              role: "user",
              content: [
                {
                  type: "document",
                  source: { type: "data", value: btoa("hello"), mimeType: "text/plain" },
                },
              ],
            },
          ],
        },
      }).pipe(Effect.flip)
      assert.equal(disabled._tag, "ChatAttachmentsDisabled")
      assert.lengthOf(admitted, 1)
    }).pipe(Effect.provide(layer))
  })

  it.effect(
    "validates outputs against the stored declaration and retains correlation without modifying calls",
    () => {
      const resolved: ResolveToolsInput[] = []
      const part = {
        id: "part",
        type: "tool-call",
        toolCallId: "provider-call",
        declaration: { outputSchema: { type: "integer", minimum: 1, maximum: 5 } },
      }
      const layer = Layer.succeed(ChatThreads, {
        getMessage: () => Effect.succeed({ payload: { version: 1, parts: [part] } }),
        resolveTools: (input: ResolveToolsInput) => {
          resolved.push(input)
          return Effect.succeed({})
        },
      } as unknown as typeof ChatThreads.Service)
      return Effect.gen(function* () {
        const input = {
          scope: commandScope,
          id: commandThreadId,
          clientId: commandUserId,
          results: [
            {
              sourceMessageId: commandThreadId,
              sourcePartId: "part",
              responseTargetId: commandTenantId,
              outcome: "succeeded" as const,
              output: 3,
            },
          ],
        }
        yield* resolveManagedChatTools(input)
        assert.deepInclude(resolved[0]!.results[0]!.payload.parts[0], {
          type: "tool-result",
          toolCallId: "provider-call",
          outcome: "succeeded",
          output: 3,
        })
        assert.equal(resolved[0]!.results[0]!.responseTargetId, commandTenantId)
        assert.isFalse("output" in part)
        for (const output of [0, 6, "3"]) {
          const invalid = yield* resolveManagedChatTools({
            ...input,
            results: [{ ...input.results[0]!, output }],
          }).pipe(Effect.result)
          assert.equal(invalid._tag, "Failure")
        }
        assert.lengthOf(resolved, 1)
        yield* resolveManagedChatTools({
          ...input,
          results: [{ ...input.results[0]!, outcome: "unknown", output: null }],
        })
        assert.lengthOf(resolved, 2)
      }).pipe(Effect.provide(layer))
    },
  )

  it.effect(
    "validates questionnaire answers against the saved questions and permits explicit closure",
    () => {
      const resolved: ResolveToolsInput[] = []
      const questions = [
        {
          name: "color",
          title: "Which color?",
          required: true,
          choices: [{ value: "red", label: "Red" }],
        },
        {
          name: "note",
          title: "Anything else?",
          choices: [],
          input: { label: "Note", placeholder: "Optional" },
        },
        {
          name: "extras",
          title: "Extras?",
          multiple: true,
          choices: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ]
      const answers = [
        { name: "color", question: "Which color?", answers: ["Red"] },
        { name: "note", question: "Anything else?", answers: [] },
        { name: "extras", question: "Extras?", answers: ["A", "B"] },
      ]
      const layer = Layer.succeed(ChatThreads, {
        getMessage: () =>
          Effect.succeed({
            payload: {
              version: 1,
              parts: [
                {
                  id: "part",
                  type: "tool-call",
                  toolCallId: "questionnaire",
                  name: "ask_questionnaire",
                  arguments: JSON.stringify({ items: questions }),
                },
              ],
            },
          }),
        resolveTools: (input: ResolveToolsInput) => {
          resolved.push(input)
          return Effect.succeed({})
        },
      } as unknown as typeof ChatThreads.Service)
      return Effect.gen(function* () {
        const input = {
          scope: commandScope,
          id: commandThreadId,
          clientId: commandUserId,
          results: [
            {
              sourceMessageId: commandThreadId,
              sourcePartId: "part",
              responseTargetId: commandTenantId,
              outcome: "succeeded" as const,
              output: { answers },
            },
          ],
        }
        for (const output of [
          { answers: answers.slice(1) },
          ...[
            { ...answers[0]!, name: "invented" },
            { ...answers[0]!, question: "Invented question" },
            { ...answers[0]!, answers: [123] },
            { ...answers[0]!, answers: [] },
            { ...answers[0]!, answers: ["red"] },
            { ...answers[0]!, answers: ["Red", "Red"] },
          ].map((answer) => ({ answers: [answer, ...answers.slice(1)] })),
          { answers: [answers[0]!, answers[0]!, answers[2]!] },
          { skipped: true, answers },
        ]) {
          const invalid = yield* resolveManagedChatTools({
            ...input,
            results: [{ ...input.results[0]!, output }],
          }).pipe(Effect.result)
          assert.equal(invalid._tag, "Failure")
        }
        assert.lengthOf(resolved, 0)
        yield* resolveManagedChatTools(input)
        yield* resolveManagedChatTools({
          ...input,
          results: [
            {
              ...input.results[0]!,
              output: {
                answers: [
                  answers[0]!,
                  { ...answers[1]!, answers: ["Free-form reply"] },
                  answers[2]!,
                ],
              },
            },
          ],
        })
        yield* resolveManagedChatTools({
          ...input,
          results: [{ ...input.results[0]!, output: { skipped: true } }],
        })
        for (const output of [null, { skipped: true }])
          yield* resolveManagedChatTools({
            ...input,
            results: [{ ...input.results[0]!, outcome: "skipped", output }],
          })
        yield* resolveManagedChatTools({
          ...input,
          results: [{ ...input.results[0]!, outcome: "unknown", output: null }],
        })
        assert.lengthOf(resolved, 6)
      }).pipe(Effect.provide(layer))
    },
  )

  it.effect(
    "validates widget results against their saved widget without requiring a declaration schema",
    () => {
      const resolved: ResolveToolsInput[] = []
      const layer = Layer.succeed(ChatThreads, {
        getMessage: () =>
          Effect.succeed({
            payload: {
              version: 1,
              parts: [
                {
                  id: "part",
                  type: "tool-call",
                  toolCallId: "render",
                  name: "render_widget",
                  arguments: JSON.stringify({ widget: "chart", props: { title: "Revenue" } }),
                },
              ],
            },
          }),
        resolveTools: (input: ResolveToolsInput) => {
          resolved.push(input)
          return Effect.succeed({})
        },
      } as unknown as typeof ChatThreads.Service)
      return Effect.gen(function* () {
        const input = {
          scope: commandScope,
          id: commandThreadId,
          clientId: commandUserId,
          results: [
            {
              sourceMessageId: commandThreadId,
              sourcePartId: "part",
              responseTargetId: commandTenantId,
              outcome: "succeeded" as const,
              output: { widget: "chart", rendered: true },
            },
          ],
        }
        const invalidOutputs = [
          { widget: "other", rendered: true },
          { widget: "chart", rendered: "true" },
        ]
        for (const output of invalidOutputs) {
          const invalid = yield* resolveManagedChatTools({
            ...input,
            results: [{ ...input.results[0]!, output }],
          }).pipe(Effect.result)
          assert.equal(invalid._tag, "Failure")
        }
        const invalidBatch = yield* resolveManagedChatTools({
          ...input,
          results: [input.results[0]!, { ...input.results[0]!, output: null }],
        }).pipe(Effect.result)
        assert.equal(invalidBatch._tag, "Failure")
        assert.lengthOf(resolved, 0)
        for (const rendered of [true, false])
          yield* resolveManagedChatTools({
            ...input,
            results: [{ ...input.results[0]!, output: { widget: "chart", rendered } }],
          })
        yield* resolveManagedChatTools({
          ...input,
          results: [
            { ...input.results[0]!, outcome: "failed", output: { error: "Render failed" } },
          ],
        })
        yield* resolveManagedChatTools({
          ...input,
          results: [{ ...input.results[0]!, outcome: "unknown", output: null }],
        })
        assert.lengthOf(resolved, 4)
      }).pipe(Effect.provide(layer))
    },
  )
})
