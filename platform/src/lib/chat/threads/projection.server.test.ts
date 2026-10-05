import { describe, expect, test } from "vitest"

import { chatStoredJson, projectChatModelHistory } from "./projection.server"
import type { ChatMessagePayload } from "./schemas"

const projectionTarget = { providerId: "provider-one", protocol: "responses", modelId: "model-one" }

function projectionRecord(
  id: string,
  payload: Omit<ChatMessagePayload, "version">,
  role: "user" | "assistant" | "tool" = "assistant",
) {
  return { id, role, state: "complete" as const, payload: { version: 1 as const, ...payload } }
}

describe("stored conversation model projection", () => {
  test("keeps unfinished tool exchanges out of context and groups completed results before interleaved input", () => {
    const calls = projectionRecord("calls", {
      parts: ["a", "b"].map((id) => ({
        id,
        type: "tool-call",
        toolCallId: `provider-${id}`,
        name: "lookup",
        arguments: "{}",
        executionLocation: "server_api",
        targets: [{ id: `target-${id}` }],
      })),
    })
    const input = projectionRecord(
      "later-input",
      {
        parts: [{ id: "text", type: "text", content: "Another participant's input" }],
      },
      "user",
    )
    const results = ["a", "b"].map((id) => ({
      ...projectionRecord(
        `result-${id}`,
        {
          parts: [{ id: "result", type: "tool-result", toolCallId: `provider-${id}`, output: id }],
        },
        "tool",
      ),
      sourceAssistantMessageId: calls.id,
      sourceToolPartId: id,
      responseTargetId: `target-${id}`,
    }))
    const records = [calls, input, ...results]
    const before = structuredClone(records)
    const incomplete = projectChatModelHistory(records.slice(0, -1))
    expect(incomplete.map((message) => message.role)).toEqual(["assistant", "user"])
    expect(incomplete[0]!.toolCalls).toBeUndefined()
    expect(JSON.stringify(incomplete[0]!.content)).toContain("awaiting confirmation")
    const complete = projectChatModelHistory(records)
    expect(complete.map((message) => message.role)).toEqual(["assistant", "tool", "tool", "user"])
    expect(complete.slice(1, 3).map((message) => message.toolCallId)).toEqual([
      "provider-a",
      "provider-b",
    ])
    expect(records).toEqual(before)
  })

  test("aggregates multiple responders into one provider result in stable target order", () => {
    const decision = projectionRecord("decision", {
      parts: [
        {
          id: "part",
          type: "tool-call",
          toolCallId: "provider",
          name: "collect",
          arguments: "{}",
          targets: [{ id: "b" }, { id: "a" }],
        },
      ],
    })
    const responses = ["b", "a"].map((id) => ({
      ...projectionRecord(
        `result-${id}`,
        {
          parts: [
            { id, type: "tool-result", toolCallId: "provider", outcome: "succeeded", output: id },
          ],
        },
        "tool",
      ),
      sourceAssistantMessageId: "decision",
      sourceToolPartId: "part",
      responseTargetId: id,
    }))
    const projected = projectChatModelHistory([decision, ...responses])
    expect(projected.map((message) => message.role)).toEqual(["assistant", "tool"])
    expect(projected[1]!.toolCallId).toBe("provider")
    expect(
      (JSON.parse(projected[1]!.content as string) as { responseTargetId: string }[]).map(
        (item) => item.responseTargetId,
      ),
    ).toEqual(["a", "b"])
  })

  test("round-trips compatible provider signatures and metadata without mutating stored rows", () => {
    const model = chatStoredJson({
      id: "upstream-message",
      role: "assistant",
      content: [{ type: "text", content: "Answer", metadata: { citation: { document: 1 } } }],
      thinking: [{ content: "Reasoning", signature: "opaque-signature" }],
      toolCalls: [
        {
          id: "provider-call",
          type: "function",
          function: { name: "lookup", arguments: "{}" },
          metadata: { thoughtSignature: "opaque-tool-signature" },
        },
      ],
      metadata: { provider: { encryptedReasoning: "opaque-record", itemId: "item-one" } },
      createdAt: new Date("2026-10-01T00:00:00Z"),
    })
    const record = projectionRecord("assistant-one", {
      parts: [{ id: "visible-text", type: "text", content: "Answer" }],
      modelMessages: [model],
      provenance: projectionTarget,
    })
    const before = structuredClone(record)
    const messages = projectChatModelHistory([record], projectionTarget)
    expect(messages).toEqual([
      {
        ...model,
        id: "assistant-one:upstream-message",
        createdAt: new Date("2026-10-01T00:00:00Z"),
        metadata: { ...(model.metadata as object), astralbeam: { messageId: record.id } },
      },
    ])
    messages[0]!.thinking![0]!.signature = "changed"
    messages[0]!.toolCalls![0]!.function.arguments = "changed"
    expect(record).toEqual(before)
  })

  test.each([
    { ...projectionTarget, providerId: "provider-two" },
    { ...projectionTarget, protocol: "chat-completions" },
    { ...projectionTarget, modelId: "model-two" },
  ])(
    "uses portable text, original files and host-tool pairs for a different target %j",
    (target) => {
      const records = [
        projectionRecord(
          "user-one",
          {
            parts: [
              { id: "input-text", type: "text", content: "Read this file" },
              {
                id: "input-file",
                type: "document",
                source: { type: "data", value: "b3JpZ2luYWw=", mimeType: "text/plain" },
                metadata: { filename: "source.txt", providerField: "opaque" },
              },
            ],
          },
          "user",
        ),
        projectionRecord("assistant-one", {
          provenance: projectionTarget,
          modelMessages: [
            {
              role: "assistant",
              content: "Provider-specific projection",
              thinking: [{ content: "Reasoning", signature: "opaque" }],
              metadata: { itemId: "opaque" },
            },
          ],
          parts: [
            { id: "thinking", type: "thinking", content: "Reasoning", signature: "opaque" },
            {
              id: "text",
              type: "text",
              content: "Looking it up",
              metadata: { providerField: "opaque" },
            },
            {
              id: "canonical-call",
              type: "tool-call",
              toolCallId: "provider-call",
              name: "lookup",
              arguments: "{}",
              state: "complete",
              executionLocation: "browser",
              targets: [{ id: "target" }],
              metadata: { thoughtSignature: "opaque" },
            },
            {
              id: "provider-tool",
              type: "tool-call",
              toolCallId: "provider-search",
              name: "web_search",
              arguments: "{}",
              metadata: { providerExecuted: true, provider: { result: "opaque" } },
            },
          ],
        }),
        {
          ...projectionRecord(
            "result-one",
            {
              parts: [
                {
                  id: "result",
                  type: "tool-result",
                  toolCallId: "provider-call",
                  content: '{"found":true}',
                },
              ],
            },
            "tool",
          ),
          sourceAssistantMessageId: "assistant-one",
          sourceToolPartId: "canonical-call",
          responseTargetId: "target",
        },
      ]
      const before = structuredClone(records)
      const messages = projectChatModelHistory(records, target)
      expect(messages).toMatchObject([
        {
          id: "user-one:input-text",
          role: "user",
          content: [
            { type: "text", content: "Read this file" },
            {
              type: "document",
              source: { type: "data", value: "b3JpZ2luYWw=", mimeType: "text/plain" },
              metadata: { filename: "source.txt" },
            },
          ],
        },
        {
          id: "assistant-one:text",
          role: "assistant",
          content: "Looking it up",
          toolCalls: [
            {
              id: "provider-call",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        {
          id: "result-one:result",
          role: "tool",
          toolCallId: "provider-call",
          content: '{"found":true}',
        },
      ])
      expect(JSON.stringify(messages)).not.toContain("opaque")
      expect(JSON.stringify(messages)).not.toContain("provider-search")
      expect(records).toEqual(before)
    },
  )

  test("keeps repeated upstream message IDs distinct and model identities stable across reads", () => {
    const records = ["assistant-one", "assistant-two"].map((id) =>
      projectionRecord(id, {
        parts: [
          { id: `${id}-one`, type: "text", content: "First" },
          { id: `${id}-two`, type: "text", content: "Second" },
        ],
        modelMessages: [
          { id: "same-upstream-id", role: "assistant", content: "First" },
          { id: "same-upstream-id", role: "assistant", content: "Second" },
        ],
        provenance: projectionTarget,
      }),
    )
    const messages = projectChatModelHistory(records, projectionTarget)
    expect(new Set(messages.map((message) => message.id)).size).toBe(4)
    expect(messages.map((message) => message.id)).toEqual([
      "assistant-one:assistant-one-one",
      "assistant-one:assistant-one-two",
      "assistant-two:assistant-two-one",
      "assistant-two:assistant-two-two",
    ])
    expect(projectChatModelHistory(records, projectionTarget)).toEqual(messages)
  })

  test("keeps parallel tool decisions together and derives their message identity from canonical parts", () => {
    const record = projectionRecord("assistant", {
      parts: [
        { id: "reasoning-part", type: "thinking", content: "Hidden on provider change" },
        ...["one", "two"].map((id) => ({
          id: `part-${id}`,
          type: "tool-call",
          toolCallId: `provider-${id}`,
          name: "lookup",
          arguments: "{}",
        })),
      ],
    })
    const messages = projectChatModelHistory([record])
    expect(messages).toMatchObject([
      { id: "assistant:part-one", toolCalls: [{ id: "provider-one" }, { id: "provider-two" }] },
    ])
    expect(messages).toHaveLength(1)
    expect(
      projectChatModelHistory([
        { ...record, payload: { ...record.payload, parts: record.payload.parts.slice(1) } },
      ]),
    ).toEqual(messages)
  })

  test("does not replay incomplete responses, unknown versions or opaque file handles", () => {
    const record = projectionRecord("assistant", {
      parts: [{ id: "text", type: "text", content: "Incomplete" }],
    })
    expect(projectChatModelHistory([{ ...record, state: "interrupted" }])).toEqual([])
    expect(projectChatModelHistory([{ ...record, state: "draft" }])).toEqual([])
    expect(() =>
      projectChatModelHistory([{ ...record, payload: { ...record.payload, version: 2 } }]),
    ).toThrow("Unsupported conversation payload version")
    expect(() =>
      projectChatModelHistory([
        projectionRecord(
          "user",
          {
            parts: [
              {
                id: "file",
                type: "document",
                source: { type: "file", value: "opaque-provider-handle" },
              },
            ],
          },
          "user",
        ),
      ]),
    ).toThrow("Provider file handles require original media")
  })
})
