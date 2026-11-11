import { useEffect, useState } from "react"

type Pattern = {
  packets: readonly string[]
  action: string
  result: string
  costDriver: string
}

type Example = { name: string; prompt: string; expensive: Pattern; better: Pattern }

const examples = {
  caching: {
    name: "Keep a stable prompt prefix",
    prompt: "Answer the next question using the same product manual.",
    expensive: {
      packets: ["New timestamp first", "Same manual", "Same instructions", "New question"],
      action: "A changed prefix prevents reuse of the following text.",
      result: "The manual has to be processed again instead of reused.",
      costDriver: "Repeated manual · new input",
    },
    better: {
      packets: ["Stable instructions", "Stable manual", "New question last"],
      action: "A later request matches the cached prefix, while it remains eligible.",
      result: "The matching prefix gets the cache rate. The new question is still new input.",
      costDriver: "Cached manual + new question",
    },
  },
  "code-mode": {
    name: "Keep intermediate data in code",
    prompt: "Find the five largest overdue invoices.",
    expensive: {
      packets: ["Invoice page 1", "Invoice page 2", "Invoice page 3", "All invoice fields"],
      action: "The model reads intermediate rows and repeatedly chooses the next tool call.",
      result: "Large tool results become model context before the answer is written.",
      costDriver: "Full intermediate results",
    },
    better: {
      packets: ["Filter + sort in sandbox", "Return five matching rows"],
      action: "Code fetches pages and calculates the result in a sandbox.",
      result: "The model receives only the rows it needs for the reply.",
      costDriver: "Selected result only",
    },
  },
  toon: {
    name: "Encode repeated structure once",
    prompt: "Read a table of invoice IDs and amounts.",
    expensive: {
      packets: ['{"id":1,"amount":50}', '{"id":2,"amount":75}', '{"id":3,"amount":90}'],
      action: "Each JSON object repeats the same field names and punctuation.",
      result: "Repeated structure takes space alongside the values.",
      costDriver: "Keys repeated per row",
    },
    better: {
      packets: ["invoices[3]{id,amount}:", "1,50", "2,75", "3,90"],
      action: "TOON declares the uniform row structure once.",
      result: "Measure actual tokens and task accuracy before choosing a format.",
      costDriver: "One shared header",
    },
  },
  compaction: {
    name: "Summarize completed conversation history",
    prompt: "Continue investigating an overdue invoice.",
    expensive: {
      packets: ["Old search results", "Resolved discussion", "Earlier tool output", "Current work"],
      action: "Every turn resends the entire investigation.",
      result: "Past details keep accumulating, including work already finished.",
      costDriver: "Growing history",
    },
    better: {
      packets: ["Saved IDs + decisions", "Summary of completed work", "Recent messages in full"],
      action: "Summarize completed work, keeping the IDs and decisions needed to continue.",
      result: "The next model call carries less history. Creating the summary also costs tokens.",
      costDriver: "Summary + recent messages",
    },
  },
  retrieval: {
    name: "Retrieve only useful context",
    prompt: "What is the cancellation policy for this plan?",
    expensive: {
      packets: ["Entire policy manual", "Unrelated plans", "Archived policy", "Duplicate passages"],
      action: "The model searches a large prompt for one current policy.",
      result: "Irrelevant text costs tokens and can obscure the applicable evidence.",
      costDriver: "Whole document collection",
    },
    better: {
      packets: ["Current plan filter", "Relevant policy passages", "Source + effective date"],
      action: "Fetch relevant passages and remove duplicate results within the input budget.",
      result: "The answer uses focused evidence with a traceable source.",
      costDriver: "Selected evidence",
    },
  },
  routing: {
    name: "Route by task difficulty",
    prompt: "Classify a ticket, then handle a difficult escalation.",
    expensive: {
      packets: ["Simple classification", "Difficult escalation"],
      action: "Both requests go to the most expensive model.",
      result: "Routine work pays the same model rate as the difficult case.",
      costDriver: "Two higher-cost model calls",
    },
    better: {
      packets: ["Small model: classify", "Strong model: escalation"],
      action: "Route evaluated task classes to a suitable model and escalate when required.",
      result: "Routine work uses a lower-cost route. Include routing and retry costs.",
      costDriver: "One small + one higher-cost call",
    },
  },
  output: {
    name: "Budget the answer",
    prompt: "Return the category and priority for this ticket.",
    expensive: {
      packets: ["Restated question", "Long explanation", "Category", "Priority"],
      action: "The model writes paragraphs the application immediately discards.",
      result: "Unused output still counts toward the bill.",
      costDriver: "Verbose generated answer",
    },
    better: {
      packets: ['{"category":"billing",', '"priority":"high"}'],
      action: "Request the required fields with an appropriate output and reasoning budget.",
      result: "Validate completeness. A limit that truncates the answer can cause retries.",
      costDriver: "Required fields only",
    },
  },
  batching: {
    name: "Move delay-tolerant work to a batch",
    prompt: "Categorize yesterday's support tickets overnight.",
    expensive: {
      packets: ["Ticket A · live request", "Ticket B · live request", "Ticket C · live request"],
      action: "Background work uses synchronous requests at the standard rate.",
      result: "The job pays for a response speed nobody needs.",
      costDriver: "Standard processing rate",
    },
    better: {
      packets: ["Queue ticket A", "Queue ticket B", "Queue ticket C"],
      action: "Submit a batch, then match each result to its request ID.",
      result: "Eligible work uses the provider's batch rate and completion window.",
      costDriver: "Discounted batch rate",
    },
  },
  "answer-cache": {
    name: "Reuse an answer when it is still valid",
    prompt: "Ask the same policy question twice.",
    expensive: {
      packets: ["Same question", "Same permissions", "Same policy version"],
      action: "The second request generates an equivalent answer again.",
      result: "A model call repeats work whose answer has not changed.",
      costDriver: "Another generation",
    },
    better: {
      packets: ["Question + user + tenant", "Policy version + expiry", "Validated cached reply"],
      action: "Check the stored reply against the user's current permissions and policy version.",
      result: "A valid hit skips generation. A changed policy or scope forces a miss.",
      costDriver: "Valid hit · no generation",
    },
  },
  budgets: {
    name: "Set usage limits and stop repeated failures",
    prompt: "Look up an invoice in a service that is unavailable.",
    expensive: {
      packets: ["Lookup fails", "Retry 1 fails", "Retry 2 fails", "Try another route…"],
      action: "The agent keeps re-reading the same error and attempting the same work.",
      result: "Calls accumulate while the underlying outage remains.",
      costDriver: "Unbounded repeated attempts",
    },
    better: {
      packets: ["Retry within the limit", "Same error detected", "Save progress + stop"],
      action: "Check retry, call, and spend limits before starting more work.",
      result: "Explain that the lookup failed and keep completed work so it can resume later.",
      costDriver: "Controlled stopping point",
    },
  },
} satisfies Record<string, Example>

export function CostDemo({ kind }: { kind: string }) {
  if (!Object.hasOwn(examples, kind)) throw new Error(`Unknown cost demo: ${kind}`)
  return <Simulation key={kind} example={examples[kind as keyof typeof examples]} />
}

function Simulation({ example }: { example: Example }) {
  const [better, setBetter] = useState(false)
  const [step, setStep] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [run, setRun] = useState(0)
  const pattern = better ? example.better : example.expensive
  const finished = better && step === 2

  useEffect(() => {
    if (!playing || finished) return
    const timer = setTimeout(
      () => {
        if (step < 2) setStep(step + 1)
        else {
          setBetter(true)
          setStep(0)
          setRun((value) => value + 1)
        }
      },
      step === 2 ? 3200 : 2400,
    )
    return () => clearTimeout(timer)
  }, [playing, finished, step, run])

  function select(nextBetter: boolean) {
    setBetter(nextBetter)
    setStep(-1)
    setPlaying(false)
  }

  function start() {
    setStep(0)
    setPlaying(true)
    setRun((value) => value + 1)
  }

  const status =
    step < 0
      ? better
        ? "Press Start to watch the better pattern."
        : "Press Start to watch the expensive approach, followed by the better pattern."
      : step === 0
        ? better
          ? "Now, the better pattern. Prepare the work."
          : "Prepare the work for the expensive approach."
        : step === 1
          ? pattern.action
          : pattern.result

  return (
    <section
      className={`cost-demo${better ? " is-better" : ""}${playing && !finished ? " is-playing" : ""}`}
      aria-label={`Simulation: ${example.name}`}
    >
      <div className="cost-window" key={run}>
        <div className="cost-heading">
          <strong>{example.name}</strong>
          <span>{better ? "Better pattern" : "Expensive approach"}</span>
        </div>
        <p className="cost-question">{example.prompt}</p>
        <div className="cost-flow">
          <div className="cost-payload">
            <span className="cost-label">{better ? "Selected work" : "Original work"}</span>
            {pattern.packets.map((packet, index) => (
              <div
                className={`cost-packet${step >= 0 ? " is-visible" : ""}`}
                key={packet}
                style={{ animationDelay: `${index * 140}ms` }}
              >
                {packet}
              </div>
            ))}
          </div>
          <div className={`cost-connector${step === 1 ? " is-active" : ""}`} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className={`cost-processor${step >= 1 ? " is-active" : ""}`}>
            <span className="cost-label">Processing</span>
            <strong>{step < 1 ? "Waiting" : step === 1 ? "Working…" : "Outcome"}</strong>
            <p>{step < 1 ? "The work starts when you play this simulation." : pattern.action}</p>
          </div>
        </div>
        <div className={`cost-outcome${step === 2 ? " is-visible" : ""}`}>
          <span aria-hidden="true">{better ? "✓" : "!"}</span>
          <p>{step === 2 ? pattern.result : "Watch the work move through the system."}</p>
        </div>
        <div className="cost-driver">
          <span className="cost-label">Cost driver</span>
          <strong>{step === 2 ? pattern.costDriver : "Awaiting outcome"}</strong>
        </div>
      </div>
      <div className="cost-controls">
        <div className="demo-modes" aria-label="Simulation mode">
          <button type="button" aria-pressed={!better} onClick={() => select(false)}>
            Expensive
          </button>
          <button type="button" aria-pressed={better} onClick={() => select(true)}>
            Better pattern
          </button>
        </div>
        <div className="cost-actions">
          {step >= 0 && (
            <button
              type="button"
              aria-disabled={finished}
              onClick={() => {
                if (!finished) setPlaying((value) => !value)
              }}
            >
              {finished ? "Finished" : playing ? "Pause" : "Resume"}
            </button>
          )}
          <button type="button" className="cost-play" onClick={start}>
            {step < 0 ? "▶ Start" : "↺ Replay"}
          </button>
        </div>
        <p role="status">{status}</p>
      </div>
      <p className="cost-disclaimer">
        Illustrative simulation. Compare actual usage, quality, and total cost for your workload.
      </p>
    </section>
  )
}
