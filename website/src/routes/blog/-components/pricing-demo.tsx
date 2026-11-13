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
        "Failed attempts count toward the 200-run allowance.",
      ],
      [
        "Run 200 enters a loop",
        "$49 revenue − $40 compute",
        "$9",
        "A run limit doesn't cap what one run costs.",
      ],
      [
        "Run 200 keeps looping",
        "$49 revenue − $65 compute",
        "−$16",
        "The last run keeps spending after the allowance is used.",
      ],
    ],
    better: [
      [
        "199 runs completed",
        "$49 revenue − $29.85 compute",
        "$19.15",
        "Each attempt now has a disclosed $0.15 compute cap.",
      ],
      [
        "Run 200 reaches its compute cap",
        "$49 revenue − $30 total compute",
        "$19",
        "The cap stops run 200 incomplete. This attempt still counts.",
      ],
      [
        "Run 200 stopped incomplete",
        "$30 total compute · no further work",
        "$19",
        "Compute stays at $30 in this example. More work needs approval.",
      ],
    ],
  },
  seats: {
    name: "Seat pricing",
    rules: [
      "$20 per invited member/month · no purchase approval",
      "$20 per invited member/month · purchase approval required",
    ],
    totalLabel: "Monthly subscription",
    failure: [
      ["Three existing members", "3 × $20", "$60", "Three invited members are already paid for."],
      [
        "Five invitations sent",
        "8 invited members × $20",
        "$160",
        "Five invitations add $100 a month without approval.",
      ],
      [
        "The invoice arrives",
        "8 billed seats",
        "$160",
        "The seat count is right. The extra purchase wasn't approved.",
      ],
    ],
    better: [
      ["Three existing members", "3 × $20", "$60", "The same three members cost the same $60."],
      [
        "Five invitations previewed",
        "+$100/month · approval pending",
        "$60",
        "The owner sees the extra $100 before buying more seats.",
      ],
      [
        "Owner approves five invitations",
        "8 invited members × $20",
        "$160",
        "Same $160 bill. The owner approved the extra $100 first.",
      ],
    ],
  },
  usage: {
    name: "Metered usage",
    rules: ["$1 per usage unit · alert at $10", "$1 per usage unit · enforced $10 budget"],
    totalLabel: "Usage charge",
    failure: [
      ["Eight units used", "8 × $1", "$8", "The account is approaching its budget."],
      ["An alert is sent", "10 × $1", "$10", "The alert warns the customer. Work keeps running."],
      [
        "Six more units run",
        "16 units total × $1",
        "$16",
        "The email warning did not cap the charge.",
      ],
    ],
    better: [
      ["Eight units used", "8 × $1", "$8", "Running jobs reserve part of the budget."],
      [
        "Two units reserved and used",
        "10 units total × $1",
        "$10",
        "The last $2 can only be spent once.",
      ],
      [
        "Further work blocked",
        "$10 limit reached",
        "$10",
        "Work stops at $10. Raise the limit to continue.",
      ],
    ],
  },
  markup: {
    name: "Cost plus markup",
    rules: [
      "Provider cost + 20% · markup called margin",
      "Provider cost + 20% · margin shown separately",
    ],
    totalLabel: "Customer charge",
    failure: [
      [
        "Model calls finish",
        "$10 provider cost",
        "—",
        "The provider charged the app. The customer bill isn't calculated yet.",
      ],
      ["Markup applied", "$10 × 1.20", "$12", "A 20% markup adds $2 to the price."],
      [
        "Reported margin: 20%",
        "$2 spread ÷ $10 cost = 20%",
        "$12",
        "Dividing by cost gives markup, not margin.",
      ],
    ],
    better: [
      [
        "Model calls finish",
        "$10 provider cost",
        "—",
        "Record the provider cost before adding your fee.",
      ],
      [
        "Service markup itemized",
        "$10 + $2 service fee",
        "$12",
        "The bill shows the $10 cost and $2 fee.",
      ],
      [
        "Margin calculated",
        "$2 ÷ $12 = 16.7%",
        "$12",
        "The $2 spread is 16.7% of the $12 sale, before other costs.",
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
        "The page calls $29 the whole price.",
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
        "The advertised $29 left out the provider's $10.",
      ],
    ],
    better: [
      [
        "Platform subscription",
        "$29 paid to the app",
        "$29",
        "Show the app fee and the separate provider bill.",
      ],
      [
        "Provider budget checked",
        "$10 authorized provider spend",
        "$29",
        "This authorizes $10. It hasn't been spent yet.",
      ],
      [
        "Job completes",
        "$29 platform + $10 provider",
        "$39",
        "Same $39, split across two bills and shown up front.",
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
      [
        "Five more premium jobs run",
        "10 jobs total × 10 credits",
        "0",
        "Ten jobs consumed the entire pack.",
      ],
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
        "Five premium jobs use 50 credits, as shown before purchase.",
      ],
      [
        "Switch to standard jobs",
        "5 × 1 credit",
        "45",
        "Five standard jobs use five credits. The balance is 45.",
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
        "The search is charged even if the issue stays open.",
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
        "Four tools worked. The issue is still open.",
      ],
    ],
    better: [
      [
        "Search approved orders",
        "1 allowed action × $0.10",
        "$0.10",
        "The customer approves the tools and budget before work starts.",
      ],
      [
        "Read approved history",
        "2 allowed actions × $0.10",
        "$0.20",
        "Reserve each action's charge before running it.",
      ],
      [
        "Further actions await approval",
        "$0.20 run cap reached",
        "$0.20",
        "The issue is still open. Ask before spending more.",
      ],
    ],
  },
  workflow: {
    name: "Workflow pricing",
    rules: ["$0.10 per completed export", "$0.10 per completed export"],
    totalLabel: "Billable job charge",
    failure: [
      [
        "Export job starts",
        "$0.10 charged before completion",
        "$0.10",
        "The app charges before it delivers the export.",
      ],
      [
        "Acknowledgement is lost",
        "Same job invoked again",
        "$0.20",
        "The app charges again for retrying the same job.",
      ],
      [
        "One export delivered",
        "2 charges × $0.10 for one export",
        "$0.20",
        "Two charges for one export. The policy promised one.",
      ],
    ],
    better: [
      [
        "Export job starts",
        "Job export_104 · pending",
        "$0.00",
        "Keep the same job ID when retrying.",
      ],
      [
        "Acknowledgement is lost",
        "Retry reconciles export_104",
        "$0.00",
        "Check the original job. Don't create another charge.",
      ],
      [
        "One export delivered",
        "1 completed job × $0.10",
        "$0.10",
        "One delivered export. One $0.10 charge.",
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
        "The app bills before confirmation. That breaks this example's policy.",
      ],
      [
        "Customer confirms resolution",
        "$1 premature charge retained",
        "$1",
        "Confirmation came later. The app billed too soon.",
      ],
      [
        "Customer reopens it on day 3",
        "$1 charge retained · no reversal",
        "$1",
        "The charge stays, despite the promised seven-day reversal.",
      ],
      [
        "Agent closes it again",
        "2 closures × $1",
        "$2",
        "Another closure adds another $1 without confirmation.",
      ],
    ],
    better: [
      [
        "Agent closes a ticket",
        "Customer confirmation pending",
        "$0",
        "Closure isn't enough. Wait for the customer to confirm.",
      ],
      [
        "Customer confirms resolution",
        "1 provisional resolution × $1",
        "$1",
        "The $1 charge can still be reversed within seven days.",
      ],
      [
        "Customer reopens it on day 3",
        "$1 outcome charge reversed",
        "$0",
        "Reverse $1. This seven-day rule is ours, not Fin's.",
      ],
      [
        "Agent closes it again",
        "New customer confirmation pending",
        "$0",
        "Closing it again adds no charge. Confirmation is still pending.",
      ],
    ],
  },
  hybrid: {
    name: "Base fee plus usage",
    rules: ["$49/month · 200 jobs · extra rate hidden", "$49/month · 200 jobs, then $0.30/job"],
    totalLabel: "Monthly invoice",
    failure: [
      [
        "Plan purchased",
        "$49 base",
        "$49",
        "The page shows $49 and leaves out the extra-job rate.",
      ],
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
        "The plan shows the monthly reset and extra-job rate.",
      ],
      [
        "200 jobs completed",
        "50 more jobs approved · $15",
        "$49",
        "The owner approves $15 before the extra jobs start.",
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
      finished ? 2000 : 1500,
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
