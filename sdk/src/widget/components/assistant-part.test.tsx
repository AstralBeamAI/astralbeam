import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import { slotNameForToolCall } from "../lib/utils.ts"
import { ChatTranscript } from "./chat-transcript.tsx"
import { AssistantPart } from "./assistant-part.tsx"
import type { ChatToolCallPart } from "../../core/threads.ts"

test.each([
  ["web_search", "input-streaming", "Searching the web", true],
  ["web_fetch", "input-complete", "Reading web pages", true],
  ["web_search", "complete", "Searched the web", false],
  ["web_fetch", "error", "Web retrieval failed", false],
] as const)("native %s activity with state %s reflects progress", (name, state, label, running) => {
  const part: ChatToolCallPart = {
    type: "tool-call",
    id: "native",
    name,
    state,
    arguments: "{}",
    metadata: { providerExecuted: true },
  }
  const html = renderToStaticMarkup(
    <AssistantPart
      part={part}
      apiUrl="http://localhost/api"
      widgets={{}}
      toolTitles={{}}
      activeSlots={new Map()}
      interactiveToolIds={new Set()}
      onQuestionnaireAnswers={vi.fn()}
    />,
  )
  expect(html).toContain(label)
  expect(html.includes('aria-live="polite"')).toBe(running)
})

test.each(["render_widget", "ask_questionnaire"])(
  "read-only transcripts show saved %s without interactive controls or live progress",
  (name) => {
    const html = renderToStaticMarkup(
      <ChatTranscript
        messages={[
          {
            id: "saved-response",
            role: "assistant",
            parts: [
              {
                type: "tool-call",
                id: "saved:decision",
                name,
                arguments: "{}",
                input: {
                  widget: "card",
                  items: [
                    {
                      name: "approval",
                      title: "Approve?",
                      choices: [{ value: "yes", label: "Yes" }],
                    },
                  ],
                },
                state: "input-complete",
              },
            ],
            metadata: { astralbeam: { state: "draft" } },
          },
        ]}
        apiUrl="http://localhost/api"
        widgets={{ card: { description: "Card", render: vi.fn() } }}
        toolTitles={{}}
        activeSlots={new Map([[slotNameForToolCall("saved:decision"), "card"]])}
        interactiveToolIds={new Set(["saved:decision"])}
        getAttachment={vi.fn()}
        hasOlder={false}
        loadingOlder={false}
        onLoadOlder={vi.fn()}
        isBusy={false}
        awaitingReply={false}
        onQuestionnaireAnswers={vi.fn()}
        readOnly
      />,
    )
    expect(html).toContain("Saved partial response")
    expect(html).not.toContain("Response in progress.")
    expect(html).not.toContain("Running")
    expect(html).not.toContain("<form")
    expect(html).not.toContain("<slot")
  },
)
