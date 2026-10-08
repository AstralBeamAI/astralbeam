import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import { slotNameForToolCall } from "../lib/utils.ts"
import { projectThreadMessages } from "../../core/threads.ts"
import { AssistantPart } from "./assistant-part.tsx"
import { ChatTranscript } from "./chat-transcript.tsx"

test.each([
  ["render_widget", true],
  ["ask_questionnaire", true],
  ["web_access", true],
  ["web_access", false],
] as const)(
  "saved %s has no interactive controls or live progress when readOnly=%s",
  (name, readOnly) => {
    const html = renderToStaticMarkup(
      <ChatTranscript
        streaming
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
                ...(name === "web_access" ? { metadata: { providerExecuted: true } } : {}),
              },
            ],
            metadata: { astralbeam: { state: readOnly ? "draft" : "interrupted" } },
          },
        ]}
        widgets={{ card: { description: "Card", render: vi.fn() } }}
        toolTitles={{}}
        activeSlots={new Map([[slotNameForToolCall("saved:decision"), "card"]])}
        interactiveToolIds={new Set(["saved:decision"])}
        hasOlder={false}
        loadingOlder={false}
        onLoadOlder={vi.fn()}
        isBusy={false}
        awaitingReply={false}
        onQuestionnaireAnswers={vi.fn()}
        readOnly={readOnly}
      />,
    )
    expect(html).toContain(readOnly ? "Saved partial response" : "Response interrupted.")
    expect(html).not.toContain("Response in progress.")
    expect(html).not.toContain("Running")
    expect(html).not.toContain("Searching and reading the web")
    expect(html).not.toContain('data-slot="spinner"')
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
