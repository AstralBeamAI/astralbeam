import { useEffect, useRef, useState } from "react"

const examples = {
  progress: {
    name: "The endless spinner",
    prompt: "Find overdue invoices and draft reminders.",
    action: "Advance 30 seconds",
  },
  reconnect: {
    name: "The lost stream",
    prompt: "Summarize this month's support tickets.",
    action: "Disconnect",
  },
  retry: {
    name: "The duplicate action",
    prompt: "Create a task: Review the launch plan.",
    action: "Retry request",
  },
  approval: {
    name: "The blank cheque",
    prompt: "Clean up the completed tasks.",
    action: "Approve",
  },
  cancel: {
    name: "The misleading stop button",
    prompt: "Send the three reminder emails.",
    action: "Stop",
  },
  partial: {
    name: "The false success",
    prompt: "Update all three project owners.",
    action: "Run update",
  },
  scroll: {
    name: "The scroll jump",
    prompt: "Read the earlier reply, then add a new one.",
    action: "Receive a reply",
  },
  draft: {
    name: "The disappearing draft",
    prompt: "Write a message, then simulate a failed send.",
    action: "Send with network error",
  },
  mobile: {
    name: "The squeezed interface",
    prompt: "Review the agent's results on your phone.",
    action: "Narrow to phone",
  },
  accessible: {
    name: "The silent update",
    prompt: "The report is ready. Can everyone tell?",
    action: "Finish report",
  },
} as const

type DemoKind = keyof typeof examples
const initialDraft = "Summarize the overdue invoices for Friday."

export function FailureDemo({ kind }: { kind: string }) {
  if (!(kind in examples)) throw new Error(`Unknown blog demo: ${kind}`)
  return <Demo key={kind} kind={kind as DemoKind} />
}

function Demo({ kind }: { kind: DemoKind }) {
  const [fixed, setFixed] = useState(false)
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState(initialDraft)
  const example = examples[kind]
  const scrollRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (kind === "scroll" && step > 0 && !fixed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [kind, step, fixed])

  function resetDemo(nextFixed = fixed) {
    setFixed(nextFixed)
    setStep(0)
    setDraft(initialDraft)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  function advanceDemo() {
    setStep(step + 1)
    if (kind === "draft" && !fixed) setDraft("")
  }

  const action = kind === "reconnect" && step === 1 ? "Reconnect" : example.action
  const repeatable = kind === "retry" || kind === "scroll"
  const lastStep = kind === "reconnect" || kind === "progress" ? 2 : 1
  const finished = !repeatable && step >= lastStep

  return (
    <section className="failure-demo" aria-label={`Interactive example: ${example.name}`}>
      <header className="demo-toolbar">
        <span className="demo-label">Try it yourself</span>
        <div className="demo-modes" aria-label="Example mode">
          <button type="button" aria-pressed={!fixed} onClick={() => resetDemo(false)}>
            Failure
          </button>
          <button type="button" aria-pressed={fixed} onClick={() => resetDemo(true)}>
            Better pattern
          </button>
        </div>
      </header>
      <div className="demo-scene">
        <div className="demo-prompt">
          <span>You</span>
          <p>{example.prompt}</p>
        </div>
        <div className="demo-agent">
          <span>Assistant</span>
          {kind === "scroll" ? (
            <>
              <textarea
                ref={scrollRef}
                className="demo-scroll"
                readOnly
                aria-label="Scrollable conversation"
                value={[
                  "The detail you were reading\nInvoice 1042 is awaiting approval.",
                  "Invoice 1043 has been paid.",
                  "Invoice 1044 is due on Friday.",
                  "Invoice 1045 needs a purchase order.",
                  ...Array.from(
                    { length: step },
                    (_, index) => `New reply ${index + 1}: the export is ready.`,
                  ),
                ].join("\n\n")}
              />
              {fixed && step > 0 && (
                <button
                  type="button"
                  className="demo-jump"
                  onClick={() => {
                    if (scrollRef.current)
                      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
                  }}
                >
                  ↓ Jump to new reply
                </button>
              )}
            </>
          ) : kind === "draft" ? (
            <>
              <label className="demo-input-label">
                Your message
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={2}
                />
              </label>
              {step > 0 && (
                <p className="demo-error" role="status">
                  Could not send.{" "}
                  {fixed
                    ? "Your draft is still here. Try again when connected."
                    : "Your message has disappeared."}
                </p>
              )}
            </>
          ) : kind === "mobile" ? (
            <div className={`demo-viewport${step > 0 ? " is-narrow" : ""}`}>
              <div className={`demo-result-table${fixed ? " is-responsive" : ""}`}>
                <div>
                  <strong>Report</strong>
                  <strong>Status</strong>
                  <strong>Action</strong>
                </div>
                <div>
                  <span>October invoices</span>
                  <span>Ready</span>
                  <span className="demo-download">Download ↓</span>
                </div>
              </div>
            </div>
          ) : (
            <DemoResult kind={kind} step={step} fixed={fixed} />
          )}
        </div>
      </div>
      <div className="demo-controls">
        <button className="demo-action" type="button" onClick={advanceDemo} disabled={finished}>
          {finished ? "Example complete" : action}
          <span aria-hidden="true"> {finished ? "✓" : "→"}</span>
        </button>
        <button
          className="demo-reset"
          type="button"
          aria-label={`Reset ${example.name}`}
          title="Reset example"
          onClick={() => resetDemo()}
        >
          ↺
        </button>
      </div>
      <p className="demo-caption">
        Interactive simulation. {fixed ? "A better response" : "Deliberately broken behavior"}.
        {kind === "progress"
          ? " Time advances only when you click."
          : " No real actions are taken."}
      </p>
    </section>
  )
}

function DemoResult({ kind, step, fixed }: { kind: DemoKind; step: number; fixed: boolean }) {
  switch (kind) {
    case "progress":
      return (
        <div role="status">
          {fixed ? (
            <>
              <p>
                {step === 0
                  ? "Looking up overdue invoices…"
                  : step === 1
                    ? "Found 12 invoices. Drafting reminders…"
                    : "12 reminder drafts are ready for review."}
              </p>
              <p className="demo-detail">
                {step * 30} seconds elapsed · {step === 2 ? "Complete" : "No emails sent"}
              </p>
            </>
          ) : (
            <>
              <p>
                <span className="demo-dots" aria-hidden="true">
                  •••
                </span>{" "}
                Thinking…
              </p>
              <p className="demo-detail">{step * 30} seconds elapsed. No other information.</p>
            </>
          )}
        </div>
      )
    case "reconnect":
      return (
        <div role="status">
          {step === 0 ? (
            <p>The most common issue was billing. Of the 48 tickets…</p>
          ) : fixed ? (
            <>
              <p>
                The most common issue was billing. Of the 48 tickets
                {step === 2 ? ", 19 concerned invoices. Login issues came next." : "…"}
              </p>
              <p className="demo-detail">
                {step === 1
                  ? "Connection lost. Keeping your partial answer."
                  : "Reconnected to the same response. Complete."}
              </p>
            </>
          ) : (
            <p className="demo-error">
              {step === 1
                ? "Connection lost. Response removed."
                : "New conversation. How can I help?"}
            </p>
          )}
        </div>
      )
    case "retry":
      return (
        <div role="status">
          <p className="demo-detail">
            The first request succeeded, but its acknowledgement was lost.
          </p>
          <div className="demo-tasks">
            {Array.from({ length: fixed ? 1 : step + 1 }, (_, index) => (
              <p key={`task-${index + 1}`}>
                <span aria-hidden="true">□</span> Review the launch plan{" "}
                <small>#{104 + index}</small>
              </p>
            ))}
          </div>
          {step > 0 && (
            <p className={fixed ? "demo-success" : "demo-error"}>
              {fixed
                ? "Same operation ID. Existing task returned."
                : `${step + 1} tasks created for one request.`}
            </p>
          )}
        </div>
      )
    case "approval":
      return (
        <div role="status">
          {step > 0 ? (
            <p className={fixed ? "demo-success" : "demo-error"}>
              {fixed
                ? "Archived the 3 reviewed tasks. Nothing deleted."
                : "Deleted 38 completed tasks. No undo available."}
            </p>
          ) : fixed ? (
            <>
              <p>
                <strong>Archive 3 completed tasks in Launch?</strong>
              </p>
              <p className="demo-detail">
                Draft announcement, Review copy, Schedule launch. You can restore them from Archive.
              </p>
            </>
          ) : (
            <p>Allow this action?</p>
          )}
        </div>
      )
    case "cancel":
      return (
        <div role="status">
          <p>
            {step === 0
              ? "Sending reminders: 1 sent, 2 queued."
              : fixed
                ? "Stopped. 1 email was already sent. 2 queued emails cancelled."
                : "Stopped."}
          </p>
          {step > 0 && (
            <p className={fixed ? "demo-detail" : "demo-error"}>
              {fixed
                ? "The sent email cannot be recalled."
                : "Behind the scenes: all 3 emails were sent."}
            </p>
          )}
        </div>
      )
    case "partial":
      return (
        <div role="status">
          {step === 0 ? (
            <p>Ready to update Cedar, Birch, and Maple.</p>
          ) : (
            <>
              <p className={fixed ? "" : "demo-success"}>
                {fixed ? "Updated 2 of 3 projects." : "Done! All project owners updated."}
              </p>
              <ul className="demo-outcomes">
                <li>✓ Cedar updated</li>
                <li>✓ Birch updated</li>
                <li className="demo-error">× Maple: permission denied</li>
              </ul>
              {fixed && (
                <p className="demo-detail">
                  Ask a project admin for access to Maple, then retry only that update.
                </p>
              )}
            </>
          )}
        </div>
      )
    case "accessible":
      return (
        <div role="status">
          <p>{step === 0 ? "Preparing report…" : "Report ready. Download CSV ↓"}</p>
          <div className="demo-reader">
            <span>Simulated screen reader output</span>
            <p>
              {step === 0
                ? "“Preparing report.”"
                : fixed
                  ? "“Report ready. Download CSV.”"
                  : "Silence. The visual update was never announced."}
            </p>
          </div>
        </div>
      )
    default:
      return null
  }
}
