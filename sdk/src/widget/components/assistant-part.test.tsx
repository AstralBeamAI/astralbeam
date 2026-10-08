import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import { slotNameForToolCall } from "../lib/utils.ts"
import { projectThreadMessages } from "../../core/threads.ts"
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

test.each(["audio", "video"])("restored assistant %s is an authenticated download", (type) => {
  const messages = projectThreadMessages([
    {
      id: "answer",
      role: "assistant",
      state: "complete",
      parent_message_id: null,
      author_tenant_user_id: null,
      source_assistant_message_id: null,
      source_tool_part_id: null,
      response_target_id: null,
      created_at: "2026-10-09T00:00:00Z",
      parts: [
        {
          id: "media",
          type,
          source: { type: "attachment", mimeType: `${type}/mp4` },
          metadata: { filename: "clip.mp4" },
        },
      ],
    },
  ])
  const html = renderToStaticMarkup(
    <AssistantPart
      part={messages[0]!.parts[0]!}
      messageId="answer"
      getAttachment={vi.fn()}
      apiUrl="http://localhost/api"
      widgets={{}}
      toolTitles={{}}
      activeSlots={new Map()}
      interactiveToolIds={new Set()}
      onQuestionnaireAnswers={vi.fn()}
    />,
  )
  expect(html).toContain('aria-label="Download clip.mp4"')
  expect(html).not.toContain('href="data:')
})
