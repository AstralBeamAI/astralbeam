import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import type { ChatToolCallPart } from "../../core/threads.ts"
import { slotNameForToolCall } from "../lib/utils.ts"
import { AssistantPart } from "./assistant-part.tsx"
import { ChatTranscript } from "./chat-transcript.tsx"

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
        widgets={{
          card: { description: "Card", render: vi.fn() },
        }}
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

test.each(["missing", undefined])("a known failure remains visible with widget %s", (widget) => {
  const part: ChatToolCallPart = {
    type: "tool-call",
    id: "saved:card",
    name: "get_todo",
    ...(widget ? { widget } : {}),
    resultVersion: 1,
    arguments: "{}",
    input: {},
    state: "complete",
    output: {
      content: [{ type: "text", text: "Todo unavailable" }],
      uiData: { privateLabel: "UI only" },
      isError: true,
    },
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
  expect(html.includes("Todo unavailable")).toBe(Boolean(widget))
  expect(html).toContain("failed")
  expect(html).not.toContain("This widget is unavailable")
  expect(html).not.toContain("Preparing a widget")
})
