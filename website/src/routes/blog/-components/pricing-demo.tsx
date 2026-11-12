import { type ReactNode, useEffect, useState } from "react"

type Step = readonly [event: string, calculation: string, total: string, note: string]
interface Example {
  name: string
  rules: readonly [failure: string, better: string]
  totalLabel: string
  failure: readonly Step[]
  better: readonly Step[]
}

const examples = {
  fixed: {
    name: "Fixed subscription",
    rules: [
      "$49/month · 200 run attempts · no per-run compute cap",
      "$49/month · 200 run attempts · $0.15 compute cap/run",
    ],
    totalLabel: "Revenue minus compute",
    failure: [
      [
        "199 runs completed",
        "$49 revenue − $29.85 compute",
        "$19.15",
        "The allowance counts run attempts, including attempts that fail.",
      ],
      [
        "Run 200 enters a loop",
        "$49 revenue − $40 compute",
        "$9",
        "Counting runs does not limit how much one run can spend.",
      ],
      [
        "Run 200 keeps looping",
        "$49 revenue − $65 compute",
        "−$16",
        "Only 200 attempts started, but the uncapped final attempt keeps spending.",
      ],
    ],
    better: [
      [
        "199 runs completed",
        "$49 revenue − $29.85 compute",
        "$19.15",
        "The plan now shows the compute limit for each attempt.",
      ],
      [
        "Run 200 reaches its compute cap",
        "$49 revenue − $30 total compute",
        "$19",
        "The incomplete run used its $0.15 cap. This attempt counts toward the allowance.",
      ],
      [
        "Run 200 stopped incomplete",
        "$30 total compute · no further work",
        "$19",
        "The fictional compute cap stops the attempt. More work requires explicit approval.",
      ],
    ],
  },
  seats: {
    name: "Seat pricing",
    rules: [
      "$20 per invited member/month · invitations unchecked",
      "$20 per invited member/month · purchase approval required",
    ],
    totalLabel: "Monthly subscription",
    failure: [
      ["Three existing members", "3 × $20", "$60", "Three invited members are already paid for."],
      [
        "Five invitations sent",
        "8 invited members × $20",
        "$160",
        "Five invitations silently add $100 to the monthly subscription.",
      ],
      [
        "The invoice arrives",
        "8 billed seats",
        "$160",
        "The price policy was followed, but nobody approved the extra purchase.",
      ],
    ],
    better: [
      ["Three existing members", "3 × $20", "$60", "The same three members cost the same $60."],
      [
        "Five invitations previewed",
        "+$100/month · approval pending",
        "$60",
        "The owner sees the increase before the invitations create paid seats.",
      ],
      [
        "Owner approves five invitations",
        "8 invited members × $20",
        "$160",
        "The $160 subscription matches the approved purchase. The seat policy is unchanged.",
      ],
    ],
  },
  usage: {
    name: "Metered usage",
    rules: ["$1 per usage unit · alert at $10", "$1 per usage unit · enforced $10 budget"],
    totalLabel: "Usage charge",
    failure: [
      ["Eight units used", "8 × $1", "$8", "The account is approaching its budget."],
      [
        "An alert is sent",
        "10 × $1",
        "$10",
        "An alert informs the customer but does not stop work.",
      ],
      ["Six more units run", "16 × $1", "$16", "The email warning did not cap the charge."],
    ],
    better: [
      [
        "Eight units used",
        "8 × $1",
        "$8",
        "The budget includes amounts reserved for jobs still running.",
      ],
      ["Two units reserved and used", "10 × $1", "$10", "The last $2 can only be spent once."],
      [
        "Further work blocked",
        "$10 limit reached",
        "$10",
        "New billable work waits for an authorized budget increase.",
      ],
    ],
  },
  markup: {
    name: "Cost plus markup",
    rules: ["Provider cost + 20% · cost hidden", "Provider cost × 1.20 · itemized"],
    totalLabel: "Customer charge",
    failure: [
      [
        "Model calls finish",
        "$10 provider cost",
        "$10",
        "The model provider has charged the app $10.",
      ],
      ["Markup applied", "$10 × 1.20", "$12", "A 20% markup adds $2 to the price."],
      [
        "Reported margin: 20%",
        "$2 spread ÷ $10 cost = 20%",
        "$12",
        "The report uses cost as the denominator, confusing markup with margin.",
      ],
    ],
    better: [
      [
        "Model calls finish",
        "$10 provider cost",
        "$10",
        "The invoice records the provider cost used to calculate the price.",
      ],
      [
        "Service markup itemized",
        "$10 + $2 service fee",
        "$12",
        "The customer can see how the $12 total was calculated.",
      ],
      [
        "Margin calculated",
        "$2 ÷ $12 = 16.7%",
        "$12",
        "Pricing distinguishes markup on cost from margin on revenue.",
      ],
    ],
  },
  byok: {
    name: "Bring your own key",
    rules: [
      "$29 platform fee · advertised as all-in",
      "$29 platform fee + direct provider charges",
    ],
    totalLabel: "Combined customer spend",
    failure: [
      [
        "Platform subscription",
        "$29 paid to the app",
        "$29",
        "The pricing page appears to promise a complete price.",
      ],
      [
        "Customer's key runs the job",
        "$10 billed by the provider",
        "$39",
        "The provider bills the customer directly.",
      ],
      [
        "Two invoices arrive",
        "$29 platform + $10 provider",
        "$39",
        "The advertised total omitted a separate usage bill.",
      ],
    ],
    better: [
      [
        "Platform subscription",
        "$29 paid to the app",
        "$29",
        "The customer sees the app fee and knows the model provider bills them separately.",
      ],
      [
        "Provider budget checked",
        "$10 authorized provider spend",
        "$29",
        "The provider budget is authorized. No provider usage has been charged yet.",
      ],
      [
        "Job completes",
        "$29 platform + $10 provider",
        "$39",
        "The combined $39 is explained, even though billing is separate.",
      ],
    ],
  },
  credits: {
    name: "Prepaid credits",
    rules: [
      "$10 for 100 credits · conversion hidden",
      "$10 for 100 credits · standard 1/job, premium 10/job",
    ],
    totalLabel: "Credits remaining",
    failure: [
      [
        "100 credits purchased",
        "Starting balance: 100",
        "100",
        "The customer assumes a credit means one job.",
      ],
      [
        "Five premium jobs run",
        "5 × 10 credits",
        "50",
        "The premium multiplier appears only after usage.",
      ],
      ["Five more premium jobs run", "10 × 10 credits", "0", "Ten jobs consumed the entire pack."],
    ],
    better: [
      [
        "100 credits purchased",
        "10 premium jobs or 100 standard jobs",
        "100",
        "The conversion is visible before purchase.",
      ],
      [
        "Five premium jobs run",
        "5 × 10 credits",
        "50",
        "The usage record matches the conversion shown before the job ran.",
      ],
      [
        "Switch to standard jobs",
        "5 × 1 credit",
        "45",
        "The customer chooses a cheaper route and keeps 45 credits.",
      ],
    ],
  },
  tool: {
    name: "Tool or action pricing",
    rules: [
      "$0.10 per action attempt · no budget",
      "$0.10 per action · approved tools · $0.20 limit",
    ],
    totalLabel: "Tool charges",
    failure: [
      [
        "Search orders succeeds",
        "1 action × $0.10",
        "$0.10",
        "The search is billable even if the customer's issue remains open.",
      ],
      [
        "Read history and search docs",
        "3 successful actions × $0.10",
        "$0.30",
        "Each tool call adds to the bill.",
      ],
      [
        "Check status succeeds",
        "4 successful actions × $0.10",
        "$0.40",
        "Four tools ran successfully, but the customer's issue is still open.",
      ],
    ],
    better: [
      [
        "Search approved orders",
        "1 allowed action × $0.10",
        "$0.10",
        "The customer approves the tool scope and budget before execution.",
      ],
      [
        "Read approved history",
        "2 allowed actions × $0.10",
        "$0.20",
        "Each action reserves its charge against the run budget.",
      ],
      [
        "Further actions await approval",
        "$0.20 run cap reached",
        "$0.20",
        "The agent reports the unresolved issue and asks before spending more.",
      ],
    ],
  },
  workflow: {
    name: "Workflow pricing",
    rules: ["$0.10 per invocation · retries count", "$0.10 per completed logical job"],
    totalLabel: "Billable job charge",
    failure: [
      [
        "Export job starts",
        "Invocation 1 × $0.10",
        "$0.10",
        "The first attempt is charged immediately.",
      ],
      [
        "Acknowledgement is lost",
        "Same job invoked again",
        "$0.20",
        "A network retry creates a second billing event.",
      ],
      [
        "One export delivered",
        "2 invocations × $0.10",
        "$0.20",
        "The customer paid twice for one delivered export.",
      ],
    ],
    better: [
      [
        "Export job starts",
        "Job export_104 · pending",
        "$0.00",
        "The job keeps the same ID if the request needs to be retried.",
      ],
      [
        "Acknowledgement is lost",
        "Retry reconciles export_104",
        "$0.00",
        "The retry checks the original job instead of charging again.",
      ],
      [
        "One export delivered",
        "1 completed job × $0.10",
        "$0.10",
        "The billing record shows one charge for the completed export.",
      ],
    ],
  },
  outcome: {
    name: "Outcome pricing",
    rules: [
      "$1 per customer-confirmed resolution · 7-day reopen reversal",
      "$1 per customer-confirmed resolution · 7-day reopen reversal",
    ],
    totalLabel: "Net outcome charge",
    failure: [
      [
        "Agent closes a ticket",
        "1 closed ticket × $1",
        "$1",
        "The app bills on closure even though the fictional policy requires customer confirmation.",
      ],
      [
        "Customer confirms resolution",
        "$1 premature charge retained",
        "$1",
        "The outcome now has confirmation, but the app charged before it was eligible.",
      ],
      [
        "Customer reopens it on day 3",
        "$1 charge retained · no reversal",
        "$1",
        "The app keeps an invalid charge despite the seven-day reversal policy.",
      ],
      [
        "Agent closes it again",
        "2 closures × $1",
        "$2",
        "The app charges again without a new confirmation, instead of honoring the reversal.",
      ],
    ],
    better: [
      [
        "Agent closes a ticket",
        "Customer confirmation pending",
        "$0",
        "An agent's closure alone is not billable under this fictional policy.",
      ],
      [
        "Customer confirms resolution",
        "1 provisional resolution × $1",
        "$1",
        "The customer-confirmed outcome is charged, subject to the seven-day reopen window.",
      ],
      [
        "Customer reopens it on day 3",
        "$1 outcome charge reversed",
        "$0",
        "Reopening within seven days reverses the charge. This is an illustrative policy, not Fin's.",
      ],
      [
        "Agent closes it again",
        "New customer confirmation pending",
        "$0",
        "Closing the ticket again neither restores the reversed charge nor confirms a new outcome.",
      ],
    ],
  },
  hybrid: {
    name: "Base fee plus usage",
    rules: ["$49 base · 200 included, overage hidden", "$49 base · 200 included, then $0.30/job"],
    totalLabel: "Monthly invoice",
    failure: [
      ["Plan purchased", "$49 base", "$49", "The base price gets all the attention."],
      [
        "200 jobs completed",
        "Included allowance exhausted",
        "$49",
        "Nothing explains what the next job will cost.",
      ],
      [
        "250 jobs completed",
        "$49 + 50 × $0.30",
        "$64",
        "The customer discovers overage on the invoice.",
      ],
    ],
    better: [
      [
        "Plan purchased",
        "$49 includes 200 jobs",
        "$49",
        "The plan states its allowance, reset, and overage rate.",
      ],
      [
        "200 jobs completed",
        "Next 50 jobs previewed at $15",
        "$49",
        "The owner approves the additional spend before it runs.",
      ],
      [
        "250 jobs completed",
        "$49 + (250 − 200) × $0.30",
        "$64",
        "The $64 invoice matches the approved estimate.",
      ],
    ],
  },
} satisfies Record<string, Example>

export function PricingDemo({ kind }: { kind: string }) {
  if (!Object.hasOwn(examples, kind)) throw new Error(`Unknown pricing demo: ${kind}`)
  return <Demo key={kind} example={examples[kind as keyof typeof examples]} />
}

function Demo({ example }: { example: Example }) {
  const [better, setBetter] = useState(false)
  const [step, setStep] = useState(-1)
  const [run, setRun] = useState(0)
  const steps = better ? example.better : example.failure
  const allSteps = [...example.failure, ...example.better]
  const finished = step === steps.length - 1

  useEffect(() => {
    if (step < 0 || (finished && better)) return
    const timer = setTimeout(
      () => {
        if (finished) {
          setBetter(true)
          setStep(0)
        } else setStep(step + 1)
      },
      finished ? 4000 : 3000,
    )
    return () => clearTimeout(timer)
  }, [step, finished, better, run])

  function select(nextBetter: boolean) {
    setBetter(nextBetter)
    setStep(-1)
  }

  const current = steps[step]
  const failurePrompt = "Press Start to watch the failure, followed by a better pattern."
  const betterPrompt = "Press Start to watch the better pattern."
  const note = current?.[3] ?? (better ? betterPrompt : failurePrompt)

  return (
    <section className="failure-demo pricing-demo" aria-label={`Simulation: ${example.name}`}>
      <div className="demo-window">
        <div className={`demo-window-bar ${better ? "is-better" : "is-failure"}`}>
          <strong>{example.name}</strong>
          <span className="pricing-reserve" aria-hidden="true">
            Better pattern
          </span>
          <span>{better ? "Better pattern" : "Failure"}</span>
        </div>
        <div className="pricing-scene">
          <p className="pricing-rule">
            <StableText variants={example.rules}>{example.rules[better ? 1 : 0]}</StableText>
          </p>
          <ol className="pricing-ledger">
            {Array.from(
              { length: Math.max(example.failure.length, example.better.length) },
              (_, index) => {
                const item = steps[index]
                const visible = item !== undefined && index <= step
                return (
                  <li
                    key={`${run}-${better}-${index}`}
                    className={visible ? undefined : "is-pending"}
                    aria-hidden={!visible}
                    aria-current={index === step ? "step" : undefined}
                  >
                    <strong>
                      <StableText
                        variants={[
                          example.failure[index]?.[0] ?? "",
                          example.better[index]?.[0] ?? "",
                        ]}
                      >
                        {item?.[0]}
                      </StableText>
                    </strong>
                    <span>
                      <StableText
                        variants={[
                          example.failure[index]?.[1] ?? "",
                          example.better[index]?.[1] ?? "",
                        ]}
                      >
                        {item?.[1]}
                      </StableText>
                    </span>
                  </li>
                )
              },
            )}
          </ol>
          <div
            className={`pricing-total${finished ? (better ? " demo-success" : " demo-error") : ""}`}
          >
            <span>{example.totalLabel}</span>
            <strong key={`${run}-${better}-${step}`}>
              <StableText variants={["—", ...allSteps.map((item) => item[2])]}>
                {current?.[2] ?? "—"}
              </StableText>
            </strong>
          </div>
        </div>
      </div>
      <div className="demo-controls">
        <div className="demo-modes" aria-label="Simulation mode">
          <button type="button" aria-pressed={!better} onClick={() => select(false)}>
            Failure
          </button>
          <button type="button" aria-pressed={better} onClick={() => select(true)}>
            Better pattern
          </button>
        </div>
        <p role="status">
          <StableText variants={[failurePrompt, betterPrompt, ...allSteps.map((item) => item[3])]}>
            {note}
          </StableText>
        </p>
        <button
          className="demo-action"
          type="button"
          onClick={() => {
            setStep(0)
            setRun(run + 1)
          }}
        >
          <StableText variants={["▶ Start", "↺ Replay"]}>
            {step < 0 ? "▶ Start" : "↺ Replay"}
          </StableText>
        </button>
      </div>
    </section>
  )
}

function StableText({ variants, children }: { variants: readonly string[]; children: ReactNode }) {
  return (
    <span className="pricing-stable">
      {variants.map((text, index) => (
        <span className="pricing-reserve" aria-hidden="true" key={index}>
          {text}
        </span>
      ))}
      <span>{children}</span>
    </span>
  )
}
