import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import type { AstralBeamApiError } from "../../api/api.ts"
import { resolveAttachmentOptions } from "../lib/attachments.ts"
import { ChatComposer } from "./chat-composer.tsx"

function renderError(error: Error) {
  return renderToStaticMarkup(
    <ChatComposer
      title="Assistant"
      draft=""
      onDraftChange={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      onRetry={undefined}
      showError
      error={error}
      streamBusy={false}
      isBusy={false}
      authPending={false}
      authError={undefined}
      onAuthRetry={undefined}
      attachments={[]}
      attachmentLimits={resolveAttachmentOptions(false)}
      onAddFiles={() => {}}
      onRemoveAttachment={() => {}}
    />,
  )
}

test("normalized transport failures do not repeat the raw error in the alert or title", () => {
  const html = renderError(new Error("HTTP error! status: 500: private server exception"))
  expect(html).toContain("The assistant service returned an error (HTTP 500).")
  expect(html).not.toContain("private server exception")
})

test("safe API details appear once with their support reference", () => {
  const detail = "The model provider rejected its configured credentials."
  const error = Object.assign(new Error(detail), {
    name: "AstralBeamApiError" as const,
    status: 503,
    headers: new Headers(),
    body: {
      type: "about:blank",
      title: "Service unavailable",
      status: 503,
      detail,
      reference: "support-123",
    },
  }) satisfies AstralBeamApiError
  const html = renderError(error)
  expect(html.split(detail)).toHaveLength(2)
  expect(html).toContain("Support reference: support-123")
})
