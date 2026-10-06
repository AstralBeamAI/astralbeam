import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import { slotNameForToolCall } from "../lib/utils.ts"
import { AssistantPart } from "./assistant-part.tsx"
import { ChatTranscript } from "./chat-transcript.tsx"

test.each(["render_widget", "ask_questionnaire", "delete_record"])(
  "read-only %s display cannot project host widgets or submit answers",
  (name) => {
    const render = vi.fn()
    const onQuestionnaireAnswers = vi.fn()
    const html = renderToStaticMarkup(
      <AssistantPart
        part={{
          type: "tool-call",
          id: "saved:decision",
          name,
          arguments: "{}",
          input: { widget: "card", items: [{ question: "Approve?", choices: ["Yes", "No"] }] },
          state: "input-complete",
        }}
        apiUrl="http://localhost/api"
        widgets={{ card: { description: "Card", render } }}
        toolTitles={{}}
        activeSlots={new Map([[slotNameForToolCall("saved:decision"), "card"]])}
        interactiveToolIds={new Set(["saved:decision"])}
        onQuestionnaireAnswers={onQuestionnaireAnswers}
        readOnly
      />,
    )
    expect(html).toContain("Saved")
    expect(html).not.toContain("Running")
    expect(html).not.toContain("<input")
    expect(html).not.toContain("<slot")
    expect(render).not.toHaveBeenCalled()
    expect(onQuestionnaireAnswers).not.toHaveBeenCalled()
  },
)

test("read-only transcript labels unfinished saved output without live progress", () => {
  const html = renderToStaticMarkup(
    <ChatTranscript
      messages={[
        {
          id: "saved-response",
          role: "assistant",
          parts: [{ type: "text", content: "Partial response" }],
          metadata: { astralbeam: { state: "draft" } },
        },
      ]}
      apiUrl="http://localhost/api"
      widgets={{}}
      toolTitles={{}}
      activeSlots={new Map()}
      interactiveToolIds={new Set()}
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
  expect(html).toContain("Partial response")
  expect(html).toContain("Saved partial response. Completion has not been recorded.")
  expect(html).not.toContain("Response in progress.")
})
