import { expect, test } from "vitest"

import { createChatAdapter } from "./adapter.server"

import type { ModelMessage } from "@tanstack/ai"

/** Responses input item, structurally: `openai` is not a direct dependency of this project. */
interface InputItem extends Record<string, unknown> {
  type?: string
}

/** `convertMessagesToInput` is protected, and its output is the whole point of the override. */
function convert(messages: Array<ModelMessage>): Array<InputItem> {
  const adapter = createChatAdapter("sk-test") as unknown as {
    convertMessagesToInput: (messages: Array<ModelMessage>) => Array<InputItem>
  }
  return adapter.convertMessagesToInput(messages)
}

// A reasoning model 400s on a replayed `function_call` whose `reasoning` item is absent, which
// broke every host tool result until the item id stopped being sent.
test("replays a tool call without the Responses item id that requires a reasoning item", () => {
  const input = convert([
    { role: "user", content: "tell me about chemical hygiene" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "searchDocuments", arguments: '{"query":"chemical hygiene"}' },
          metadata: { itemId: "fc_0d130cb4c88ab49e" },
        },
      ],
    },
    { role: "tool", toolCallId: "call_1", content: '{"results":[]}' },
  ])

  const functionCall = input.find((item) => item.type === "function_call")
  expect(functionCall).toMatchObject({ type: "function_call", call_id: "call_1" })
  expect(functionCall).not.toHaveProperty("id")

  // The result still has to reach the model, or the run resumes with no tool output.
  expect(input.at(-1)).toMatchObject({ type: "function_call_output", call_id: "call_1" })
})
