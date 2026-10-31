import { type MouseEvent, useRef } from "react"

import { CheckIcon, CloseIcon, CopyIcon } from "@/components/icons"
import { agentSetupPrompt } from "@/lib/agent-setup-prompt"
import { siteMetadata } from "@/lib/site"

const { signUp: signUpUrl, docs: docsUrl } = siteMetadata.links

// Toggles the label with a data attribute because nothing on this page re-renders.
async function copyPrompt(event: MouseEvent<HTMLButtonElement>, dialog: HTMLDialogElement | null) {
  const button = event.currentTarget
  try {
    await navigator.clipboard.writeText(agentSetupPrompt)
    button.dataset.copied = ""
    setTimeout(() => delete button.dataset.copied, 2000)
  } catch {
    // Clipboard access can be denied, so select the prompt for a manual copy instead.
    dialog?.showModal()
    const prompt = dialog?.querySelector(".prompt-text")
    if (prompt) getSelection()?.selectAllChildren(prompt)
    dialog?.setAttribute("data-copy-failed", "")
  }
}

export function CopyPrompt() {
  const dialogRef = useRef<HTMLDialogElement>(null)

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-lg copy-prompt"
        title="Set up AstralBeam with your coding agent"
        onClick={(event) => void copyPrompt(event, dialogRef.current)}
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
            <li>
              Open your app’s repository in Cursor, Claude Code, Codex, or another coding agent.
            </li>
            <li>Copy and paste the prompt below to start the integration.</li>
          </ol>
          <pre className="prompt-text mono">{agentSetupPrompt}</pre>
          <p className="prompt-note">
            <a href={signUpUrl} target="_blank" rel="noopener noreferrer">
              Sign up
            </a>{" "}
            and create an organization API key to authorize chat requests.
          </p>
          <p className="prompt-manual" role="status">
            Your browser blocked the clipboard, so the prompt is selected. Copy it with Ctrl+C or
            ⌘C.
          </p>
          <div className="prompt-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg copy-prompt"
              onClick={(event) => void copyPrompt(event, dialogRef.current)}
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
              READ QUICKSTART
            </a>
          </div>
        </div>
      </dialog>
    </>
  )
}
