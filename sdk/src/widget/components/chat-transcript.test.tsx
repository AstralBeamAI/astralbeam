import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { ChatTranscript } from "./chat-transcript.tsx"

test("loading saved history does not show the new conversation invitation", () => {
  const html = renderToStaticMarkup(
    <ChatTranscript
      messages={[]}
      widgets={{}}
      toolTitles={{}}
      activeSlots={new Map()}
      interactiveToolIds={new Set()}
      getAttachment={() => Promise.resolve(new Blob())}
      hasOlder={false}
      loadingHistory
      loadingOlder={false}
      onLoadOlder={() => Promise.resolve()}
      isBusy={false}
      awaitingReply={false}
      onQuestionnaireAnswers={() => {}}
      emptyHeadline="New conversation invitation"
    />,
  )
  expect(html).toContain("Loading conversation")
  expect(html).not.toContain("New conversation invitation")
})

test("an empty saved reply keeps its interruption warning", () => {
  const html = renderToStaticMarkup(
    <ChatTranscript
      messages={[
        { id: "user", role: "user", parts: [{ type: "text", content: "Hello" }] },
        {
          id: "reply",
          role: "assistant",
          parts: [],
          metadata: { astralbeam: { state: "interrupted" } },
        },
      ]}
      widgets={{}}
      toolTitles={{}}
      activeSlots={new Map()}
      interactiveToolIds={new Set()}
      getAttachment={() => Promise.resolve(new Blob())}
      hasOlder={false}
      loadingOlder={false}
      onLoadOlder={() => Promise.resolve()}
      isBusy={false}
      awaitingReply={false}
      onQuestionnaireAnswers={() => {}}
    />,
  )
  expect(html).toContain("Response interrupted")
})
