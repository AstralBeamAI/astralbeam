import { type MouseEvent, useRef } from "react"

import { CheckIcon, CloseIcon, CopyIcon } from "@/components/icons"
import { siteMetadata } from "@/lib/site"

const { signUp: signUpUrl, docs: docsUrl } = siteMetadata.links

const agentPrompt = `Add an AstralBeam agent sidebar/screen to this app by following ${docsUrl}/start/quickstart.md and these steps: install @astralbeam/sdk, add a server endpoint that mints a chat token with createAstralBeamToken for the signed-in user and their tenant, and mount the chat where the sidebar/screen belongs (<AstralBeamChat /> from @astralbeam/sdk/react in React apps, or mountAstralBeamChat from @astralbeam/sdk/client otherwise). Read ASTRALBEAM_API_KEY from the server environment and never expose it to browser code.`

// Toggles the label with a data attribute because nothing on this page re-renders.
function copyPrompt(event: MouseEvent<HTMLButtonElement>) {
  const button = event.currentTarget
  navigator.clipboard.writeText(agentPrompt).then(
    () => {
      button.dataset.copied = ""
      setTimeout(() => delete button.dataset.copied, 2000)
    },
    () => {
      // Clipboard access can be denied, so select the prompt for a manual copy instead.
      const prompt = button.closest("dialog")?.querySelector(".prompt-text")
      if (prompt) getSelection()?.selectAllChildren(prompt)
      button.closest("dialog")?.setAttribute("data-copy-failed", "")
    },
  )
}

export function CopyPrompt() {
  const dialogRef = useRef<HTMLDialogElement>(null)

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-lg"
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        <CopyIcon />
        COPY PROMPT
      </button>
      {/* Light dismiss where supported, otherwise Escape and the close button.
          https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog#closedby */}
      <dialog
        ref={dialogRef}
        className="prompt-dialog"
        aria-labelledby="prompt-title"
        closedby="any"
      >
        <div className="panel prompt-panel">
          <header className="prompt-head">
            <h2 className="display prompt-title" id="prompt-title">
              BUILD IT WITH YOUR CODING AGENT
            </h2>
            <button
              type="button"
              className="prompt-close"
              aria-label="Close"
              onClick={() => dialogRef.current?.close()}
            >
              <CloseIcon />
            </button>
          </header>
          <ol className="prompt-steps">
            <li>Copy the prompt below.</li>
            <li>
              Open a coding agent (Cursor, Claude Code, Codex, etc.) in the repo where you want to
              add AstralBeam.
            </li>
            <li>
              Paste the prompt. The agent will install the SDK and integrate AstralBeam into your
              app.
            </li>
          </ol>
          <pre className="prompt-text mono">{agentPrompt}</pre>
          <p className="prompt-note">
            The integration reads <code className="mono">ASTRALBEAM_API_KEY</code> from your server
            environment. <a href={signUpUrl}>Sign up</a> to create one.
          </p>
          <p className="prompt-manual" role="status">
            Your browser blocked the clipboard, so the prompt is selected. Copy it with Ctrl+C or
            ⌘C.
          </p>
          <div className="prompt-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg copy-prompt"
              onClick={copyPrompt}
            >
              <span>
                <CopyIcon />
                COPY PROMPT
              </span>
              <span>
                <CheckIcon />
                COPIED
              </span>
            </button>
            <a className="btn btn-ghost btn-lg" href={`${docsUrl}/start/quickstart`}>
              READ THE QUICKSTART
            </a>
          </div>
        </div>
      </dialog>
    </>
  )
}
