import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { resolveAttachmentOptions } from "../lib/attachments.ts"
import { ChatComposer } from "./chat-composer.tsx"

test("normalized transport failures do not repeat the raw error in the alert or title", () => {
  const html = renderToStaticMarkup(
    <ChatComposer
      title="Assistant"
      draft=""
      onDraftChange={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      onRetry={undefined}
      retryLabel="Retry"
      showError
      error={new Error("HTTP error! status: 500: private server exception")}
      streamBusy={false}
      isBusy={false}
      authPending={false}
      authError={undefined}
      onAuthRetry={undefined}
      attachments={[]}
      attachmentLimits={resolveAttachmentOptions(false)}
      onAddFiles={() => {}}
      onRemoveAttachment={() => {}}
      onPauseAttachment={() => {}}
      onResumeAttachment={() => false}
      onReselectAttachment={() => {}}
    />,
  )
  expect(html).toContain("The assistant service returned an error (HTTP 500).")
  expect(html).not.toContain("private server exception")
})
