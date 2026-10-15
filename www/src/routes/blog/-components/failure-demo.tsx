import { type ReactNode, useEffect, useRef, useState } from "react"

// Each step lasts `ms` before the next one starts, and the final step uses 0.
type Step = readonly [ms: number, note: string, fixedNote?: string]

const examples = {
  progress: {
    name: "The endless spinner",
    prompt: "Find overdue invoices and draft reminders.",
    steps: [
      [1600, "The agent starts working.", "The agent says what it is doing right now."],
      [
        1800,
        "Twenty seconds later, it still says only “Thinking…”.",
        "It reports what it found and what comes next.",
      ],
      [
        1800,
        "Is it working, stuck, or waiting for you?",
        "Progress comes from the execution state, not an invented percentage.",
      ],
      [
        0,
        "A minute in, you still can't tell whether to wait or refresh.",
        "It ends with a clear outcome. Nothing was sent without you.",
      ],
    ],
  },
  reconnect: {
    name: "The lost stream",
    prompt: "Summarize this month's support tickets.",
    steps: [
      [2200, "The answer starts streaming in."],
      [2000, "Your phone switches networks mid-response."],
      [
        0,
        "Reconnecting starts a new conversation. The partial answer is gone.",
        "The client rejoins the same response and keeps streaming.",
      ],
    ],
  },
  retry: {
    name: "The duplicate action",
    prompt: "Create a task: Review the launch plan.",
    steps: [
      [1400, "The agent calls the create-task tool."],
      [1500, "The server creates the task…"],
      [1700, "…but the response never reaches the browser."],
      [1000, "You press Retry."],
      [1500, "The retry sends the same write again.", "The retry reuses the operation ID."],
      [
        0,
        "Now there are two identical tasks.",
        "The server returns the existing task. Nothing is duplicated.",
      ],
    ],
  },
  approval: {
    name: "The blank cheque",
    prompt: "Clean up the completed tasks.",
    steps: [
      [1400, "The agent proposes an action."],
      [
        2400,
        "The approval says nothing about what will happen.",
        "The approval names the action, the records, and the way back.",
      ],
      [1000, "You approve it."],
      [
        0,
        "“Allow” meant permanently deleting 38 tasks across every project.",
        "Exactly the reviewed tasks are archived, and you can undo it.",
      ],
    ],
  },
  cancel: {
    name: "The misleading stop button",
    prompt: "Send the three reminder emails.",
    steps: [
      [1300, "The agent starts sending."],
      [1300, "The first email goes out."],
      [1000, "You press Stop."],
      [
        1500,
        "The chat says “Stopped,” but only the text stopped.",
        "Stop reaches the tool, and the chat waits for confirmation.",
      ],
      [
        0,
        "Behind the scenes, every email was sent.",
        "It reports what was sent, what was cancelled, and what can't be undone.",
      ],
    ],
  },
  partial: {
    name: "The false success",
    prompt: "Make Dana the owner of all three projects.",
    steps: [
      [1100, "The agent updates each project."],
      [900, "Cedar is updated."],
      [900, "Birch is updated."],
      [1300, "Maple fails with a permission error."],
      [
        0,
        "The summary celebrates anyway. Maple is unchanged.",
        "The summary matches the tool results and explains how to fix Maple.",
      ],
    ],
  },
  scroll: {
    name: "The scroll jump",
    prompt: "Export these as a CSV.",
    steps: [
      [1300, "The agent starts the export."],
      [1700, "While you wait, you scroll up to reread invoice 1042."],
      [
        1700,
        "The reply arrives and yanks you to the bottom.",
        "Your position holds, and a pill says a new reply arrived.",
      ],
      [1000, "Now you have to find your place again.", "You jump when you're ready."],
      [0, "Now you have to find your place again.", "You jump when you're ready."],
    ],
  },
  draft: {
    name: "The disappearing draft",
    prompt: "Summarize the overdue invoices for Friday and flag anything over $5,000.",
    steps: [
      [
        1500,
        "You send it, and the composer clears right away.",
        "You send it, and the message waits for the server to confirm.",
      ],
      [
        0,
        "The network fails, and your message is gone.",
        "The network fails. Your draft is back in the composer, ready to retry.",
      ],
    ],
  },
  mobile: {
    name: "The squeezed interface",
    prompt: "Show me this month's reports.",
    steps: [
      [1600, "The agent returns a table of results."],
      [2200, "Now open the same chat on a phone."],
      [
        0,
        "The table keeps its desktop width, and Download is cut off.",
        "The results reflow into cards, and every action stays reachable.",
      ],
    ],
  },
  accessible: {
    name: "The silent update",
    prompt: "Export October's invoices as a CSV.",
    steps: [
      [2000, "The agent prepares the report."],
      [2200, "The report appears on screen."],
      [
        0,
        "A screen reader user hears nothing and keeps waiting.",
        "The finished state is announced once, without reading every token.",
      ],
    ],
  },
} satisfies Record<string, { name: string; prompt: string; steps: readonly Step[] }>

type DemoKind = keyof typeof examples
const panels: Partial<Record<DemoKind, string>> = {
  retry: "Tasks",
  cancel: "Outbox",
  partial: "Projects",
  accessible: "Screen reader",
}
const typeMs = 40

export function FailureDemo({ kind }: { kind: string }) {
  if (!(kind in examples)) throw new Error(`Unknown blog demo: ${kind}`)
  return <Demo key={kind} kind={kind as DemoKind} />
}

function Demo({ kind }: { kind: DemoKind }) {
  const example = examples[kind]
  const steps: readonly Step[] = example.steps
  const [fixed, setFixed] = useState(false)
  // -1 is idle, 0 types the prompt, and later steps play `steps[step - 1]`.
  const [step, setStep] = useState(-1)
  const [run, setRun] = useState(0)
  const threadRef = useRef<HTMLDivElement>(null)
  const s = step - 1
  const finished = s === steps.length - 1

  useEffect(() => {
    // A finished failure hands off to the better pattern after a pause to read the last note.
    const handoff = !fixed && step === steps.length
    const delay = step === 0 ? example.prompt.length * typeMs + 600 : steps[step - 1]?.[0]
    if (!delay && !handoff) return
    const timer = setTimeout(
      () => {
        if (!handoff) return setStep(step + 1)
        setFixed(true)
        setStep(0)
        setRun((value) => value + 1)
      },
      handoff ? 3000 : delay,
    )
    return () => clearTimeout(timer)
  }, [example, steps, step, fixed])

  useEffect(() => {
    const thread = threadRef.current
    if (kind !== "scroll" || !thread) return
    const reading = thread.querySelector<HTMLElement>(".demo-reading")
    if (s === 1 && reading) thread.scrollTo({ top: reading.offsetTop - 16, behavior: "smooth" })
    else if (s < 1 || s === (fixed ? 4 : 2)) {
      thread.scrollTo({
        top: thread.scrollHeight,
        behavior: s < 0 || !fixed ? "instant" : "smooth",
      })
    }
  }, [kind, s, fixed, run])

  function play(nextFixed: boolean, nextStep: number) {
    setFixed(nextFixed)
    setStep(nextStep)
    setRun(run + 1)
  }

  const note =
    s < -1
      ? `Press Start to watch ${fixed ? "the better pattern" : "the failure, then a better pattern"}.`
      : s === -1
        ? fixed
          ? "Now, a better pattern…"
          : "You type a request."
        : ((fixed ? steps[s]?.[2] : undefined) ?? steps[s]?.[1])
  const lost = !fixed && ((kind === "reconnect" && s >= 2) || (kind === "draft" && s >= 1))
  const offline = (kind === "reconnect" && s === 1) || (kind === "draft" && s >= 1)
  const busy = s >= 0 && !finished && kind !== "draft" && !(kind === "cancel" && !fixed && s >= 3)
  const panel = panels[kind]

  return (
    <section className="failure-demo" aria-label={`Simulation: ${example.name}`}>
      <div key={run} className={`demo-stage${panel ? " has-panel" : ""}`}>
        <div className={`demo-window${kind === "mobile" && s >= 1 ? " is-narrow" : ""}`}>
          <div className={`demo-window-bar ${fixed ? "is-better" : "is-failure"}`}>
            <strong>Assistant</strong>
            <span className={offline ? "is-offline" : ""}>{offline ? "Offline" : "Online"}</span>
          </div>
          <div
            className={`demo-thread${kind === "scroll" ? " is-scrollable" : ""}`}
            ref={threadRef}
          >
            {kind === "scroll" && <History reading={s >= 1} />}
            {s >= 0 && !lost && (
              <div className="demo-user">
                {example.prompt}
                {kind === "draft" && <small>{s === 0 ? "Sending…" : "Not sent · Retry"}</small>}
              </div>
            )}
            {s >= 0 && (
              <div className="demo-agent">
                <Scene kind={kind} s={s} fixed={fixed} />
              </div>
            )}
          </div>
          {kind === "scroll" && fixed && (s === 2 || s === 3) && (
            <span className="demo-pill">
              ↓ New reply
              {s === 3 && <Pointer />}
            </span>
          )}
          <div className="demo-composer">
            {s === -1 ? (
              <span>
                <Typed text={example.prompt} speed={typeMs} />
                <span className="demo-caret" />
              </span>
            ) : kind === "draft" && fixed && s >= 1 ? (
              <span>{example.prompt}</span>
            ) : (
              <span className="demo-placeholder">Ask anything</span>
            )}
            <span className={`demo-send${busy ? " is-stop" : ""}`} aria-hidden="true">
              {busy ? "■" : "↑"}
              {kind === "cancel" && s === 2 && <Pointer />}
            </span>
          </div>
        </div>
        {panel && (
          <aside className={`demo-panel${kind === "accessible" ? " is-reader" : ""}`}>
            <span>{panel}</span>
            <Panel kind={kind} s={s} fixed={fixed} />
          </aside>
        )}
      </div>
      <div className="demo-controls">
        <div className="demo-modes" aria-label="Example mode">
          <button type="button" aria-pressed={!fixed} onClick={() => play(false, -1)}>
            Failure
          </button>
          <button type="button" aria-pressed={fixed} onClick={() => play(true, -1)}>
            Better pattern
          </button>
        </div>
        <p role="status">{note}</p>
        <button className="demo-action" type="button" onClick={() => play(fixed, 0)}>
          {s < -1 ? "▶ Start" : "↺ Replay"}
        </button>
      </div>
    </section>
  )
}

function Scene({ kind, s, fixed }: { kind: DemoKind; s: number; fixed: boolean }) {
  switch (kind) {
    case "progress":
      return (
        <>
          {fixed ? (
            <>
              <Tool status={s > 0 ? "ok" : "run"}>
                {s > 0 ? "Found 12 overdue invoices" : "Searching invoices"}
              </Tool>
              {s > 0 && (
                <Tool status={s === 3 ? "ok" : "run"}>
                  {s === 3 ? "Drafted 12 reminders" : `Drafting reminders · ${s * 4} of 12`}
                </Tool>
              )}
              {s === 3 && (
                <p>
                  <Typed text="12 reminder drafts are ready for your review. No emails have been sent." />
                </p>
              )}
            </>
          ) : (
            <p>
              <span className="demo-dots" aria-hidden="true">
                •••
              </span>{" "}
              Thinking…
            </p>
          )}
          <p className="demo-detail">
            <Clock running={s < 3} /> elapsed
          </p>
        </>
      )
    case "reconnect": {
      const start = "The most common issue was billing. Of the 48 tickets,"
      if (!fixed && s === 1) return <Tool status="fail">Connection lost. Response removed.</Tool>
      if (!fixed && s === 2)
        return (
          <p>
            <Typed text="Hi! How can I help you today?" />
          </p>
        )
      return (
        <>
          <p>
            {s === 0 ? <Typed text={start} /> : start}
            {s === 2 && (
              <Typed text=" 19 concerned invoices, and login problems came next with 11." />
            )}
          </p>
          {s === 1 && <Tool status="run">Connection lost. Reconnecting to this response</Tool>}
        </>
      )
    }
    case "retry":
      return (
        <>
          <Tool status={s < 2 ? "run" : "fail"}>{s < 2 ? "Creating task" : "Request failed"}</Tool>
          {(s === 2 || s === 3) && (
            <p>
              <span className="demo-btn">
                Retry
                {s === 3 && <Pointer />}
              </span>
            </p>
          )}
          {s >= 4 && (
            <Tool status={s === 4 ? "run" : "ok"}>
              {fixed
                ? s === 4
                  ? "Checking operation op_7f3a"
                  : "Found existing task #104"
                : s === 4
                  ? "Creating task"
                  : "Created task #105"}
            </Tool>
          )}
          {s === 5 && (
            <p>
              <Typed text={`Created “Review the launch plan” (#${fixed ? 104 : 105}).`} />
            </p>
          )}
        </>
      )
    case "approval":
      return (
        <>
          <p>
            <Typed text="I can clean those up for you." />
          </p>
          {s >= 1 && (
            <div className="demo-card">
              {fixed ? (
                <>
                  <strong>Archive 3 completed tasks in Launch?</strong>
                  <ul>
                    <li>Draft announcement</li>
                    <li>Review copy</li>
                    <li>Schedule launch</li>
                  </ul>
                  <small>You can restore them from Archive.</small>
                </>
              ) : (
                <strong>Allow this action?</strong>
              )}
              {s < 3 ? (
                <div>
                  <span className="demo-btn">{fixed ? "Cancel" : "Deny"}</span>
                  <span className="demo-btn is-primary">
                    {fixed ? "Archive 3 tasks" : "Allow"}
                    {s === 2 && <Pointer />}
                  </span>
                </div>
              ) : (
                <small>✓ Approved</small>
              )}
            </div>
          )}
          {s === 3 &&
            (fixed ? (
              <Tool status="ok">
                Archived 3 tasks in Launch · <u>Undo</u>
              </Tool>
            ) : (
              <Tool status="fail">Deleted 38 completed tasks in all projects. No undo.</Tool>
            ))}
        </>
      )
    case "cancel":
      return (
        <>
          <Tool status={s < 3 || (fixed && s === 3) ? "run" : "ok"}>
            {s < 3
              ? `Sending reminders · ${s > 0 ? 1 : 0} of 3 sent`
              : fixed && s === 3
                ? "Stopping the email tool"
                : "Stopped"}
          </Tool>
          {fixed && s === 4 && (
            <p>
              <Typed text="1 email was already sent and can't be recalled. The 2 queued emails were cancelled." />
            </p>
          )}
        </>
      )
    case "partial":
      return fixed ? (
        <>
          {["Cedar", "Birch", "Maple"].map(
            (name, index) =>
              s >= index && (
                <Tool key={name} status={s > index ? (index === 2 ? "fail" : "ok") : "run"}>
                  {name}
                  {s > index && (index === 2 ? ": permission denied" : ": Dana is the owner")}
                </Tool>
              ),
          )}
          {s === 4 && (
            <p>
              <Typed text="Dana now owns 2 of 3 projects. Ask a Maple admin for access, then I'll retry only Maple." />
            </p>
          )}
        </>
      ) : (
        <>
          <Tool status={s < 4 ? "run" : "ok"}>Updating project owners</Tool>
          {s === 4 && (
            <p className="demo-success">
              <Typed text="Done! Dana now owns all three projects." />
            </p>
          )}
        </>
      )
    case "scroll":
      return (
        <>
          <Tool status={s < 2 ? "run" : "ok"}>
            {s < 2 ? "Exporting invoices" : "Exported 5 invoices"}
          </Tool>
          {s >= 2 && (
            <p>
              The export is ready: <span className="demo-link">invoices-october.csv</span>
            </p>
          )}
        </>
      )
    case "draft":
      return s >= 1 ? (
        <Tool status="fail">
          {fixed
            ? "Couldn't send. Your draft is back below."
            : "Couldn't send. Check your connection."}
        </Tool>
      ) : null
    case "mobile":
      return (
        <>
          <p>
            <Typed text="Here are this month's reports:" />
          </p>
          <div className={`demo-table${fixed ? " is-responsive" : ""}`}>
            <div>
              <strong>Report</strong>
              <strong>Status</strong>
              <strong>Action</strong>
            </div>
            {["October invoices", "Q3 summary"].map((report) => (
              <div key={report}>
                <span>{report}</span>
                <span>Ready</span>
                <span className="demo-link">Download ↓</span>
              </div>
            ))}
          </div>
        </>
      )
    case "accessible":
      return s < 1 ? (
        <Tool status="run">Preparing report</Tool>
      ) : (
        <>
          <Tool status="ok">Report ready</Tool>
          <p>
            <span className="demo-btn">↓ invoices-october.csv</span>
          </p>
        </>
      )
  }
}

function Panel({ kind, s, fixed }: { kind: DemoKind; s: number; fixed: boolean }) {
  switch (kind) {
    case "retry":
      return s < 1 ? (
        <p className="demo-detail">No tasks yet</p>
      ) : (
        [104, 105].map(
          (id) =>
            (id === 104 || (!fixed && s === 5)) && (
              <Row key={id} label="Review the launch plan" status={`#${id}`} />
            ),
        )
      )
    case "cancel": {
      if (s < 0) return <p className="demo-detail">Empty</p>
      const sent = fixed ? Math.min(s, 1) : s >= 3 ? s - 1 : Math.min(s, 1)
      return ["Acme", "Birch Co", "Cedar Ltd"].map((name, index) => (
        <Row
          key={name}
          label={name}
          status={index < sent ? "Sent" : fixed && s === 4 ? "Cancelled" : "Queued"}
          error={index > 0 && index < sent}
        />
      ))
    }
    case "partial":
      return ["Cedar", "Birch", "Maple"].map((name, index) => (
        <Row
          key={name}
          label={name}
          status={s > index ? (index === 2 ? "Lee · denied" : "Dana") : "Lee"}
          error={s > index && index === 2}
        />
      ))
    case "accessible":
      return (
        <>
          {s >= 0 && <p>“Message sent.”</p>}
          {s >= 1 &&
            (fixed ? (
              <p>“Report ready. Download invoices-october.csv, button.”</p>
            ) : (
              <p className="demo-silence">Silence</p>
            ))}
        </>
      )
    default:
      return null
  }
}

function History({ reading }: { reading: boolean }) {
  return (
    <>
      <div className="demo-user">Which invoices need attention?</div>
      <div className="demo-agent">
        <p>Here is where each open invoice stands:</p>
        <p className={`demo-reading${reading ? " is-highlighted" : ""}`}>
          Invoice 1042 is awaiting approval from Priya in finance.
        </p>
        <p>Invoice 1043 was paid on Monday.</p>
        <p>Invoice 1044 is due on Friday.</p>
        <p>Invoice 1045 needs a purchase order.</p>
        <p>Invoice 1046 is disputed by the customer.</p>
      </div>
    </>
  )
}

function Tool({ status, children }: { status: "run" | "ok" | "fail"; children: ReactNode }) {
  return (
    <p className={`demo-tool is-${status}`}>
      <span aria-hidden="true">{status === "ok" ? "✓" : status === "fail" ? "×" : ""}</span>
      {children}
    </p>
  )
}

function Row({ label, status, error }: { label: string; status: string; error?: boolean }) {
  return (
    <p className="demo-row">
      {label}
      <small key={status} className={error ? "demo-error" : undefined}>
        {status}
      </small>
    </p>
  )
}

function Typed({ text, speed = 18 }: { text: string; speed?: number }) {
  const [length, setLength] = useState(0)
  useEffect(() => {
    if (length >= text.length) return
    const timer = setTimeout(() => setLength(length + 1), speed)
    return () => clearTimeout(timer)
  }, [length, text, speed])
  return text.slice(0, length)
}

function Clock({ running }: { running: boolean }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!running) return
    // One simulated second every 80 ms keeps a minute-long wait under six seconds.
    const timer = setInterval(() => setSeconds((value) => value + 1), 80)
    return () => clearInterval(timer)
  }, [running])
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function Pointer() {
  return (
    <svg className="demo-pointer" viewBox="0 0 16 22" width="16" height="22" aria-hidden="true">
      <path d="M1 1v17l4.5-4.5 3 7 3-1.3-3-6.7H15z" />
    </svg>
  )
}
