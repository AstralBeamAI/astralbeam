import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { resolveAttachmentOptions } from "../lib/attachments.ts"
import { ChatComposer } from "./chat-composer.tsx"

test("transport and authentication errors keep private diagnostics out of the UI", () => {
  const authError = Object.assign(new Error("private server exception"), {
    name: "AstralBeamApiError",
    status: 401,
  })
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
      authError={authError}
      onAuthRetry={undefined}
      attachments={[]}
      attachmentLimits={resolveAttachmentOptions(false)}
      onAddFiles={() => {}}
      onRemoveAttachment={() => {}}
    />,
  )
  expect(html).toContain("The assistant service returned an error (HTTP 500).")
  expect(html).toContain("connection was rejected")
  expect(html).not.toContain("private server exception")
})
