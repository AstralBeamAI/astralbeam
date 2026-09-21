import { Fragment, type ReactNode } from "react"

interface Benefit {
  name: string
  desc: string
  soon?: boolean
}

interface Step {
  index: string
  title: string
  desc: string
  file: string
  code: string
  benefits: Benefit[]
}

export const steps: Step[] = [
  {
    index: "01",
    title: "ADD THE FRONTEND SDK",
    desc:
      "Install one package and mount one component. You get a complete agent sidebar that already streams, retries, reads files, and matches your product.",
    file: "sidebar.tsx",
    code: `$ npm install @astralbeam/sdk
+ added 1 package

import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <AstralBeamChat
      title="Acme Assistant"
      theme={{
        light: {
          "--primary": "#4f46e5",
          "--radius": "0.75rem",
        },
        dark: {
          "--primary": "#818cf8",
        }}}
      attachments={{ maxFiles: 5 }}
    />
  )
}`,
    benefits: [
      {
        name: "Cursor-style agentic chat",
        desc:
          "Streaming replies, visible tool calls, and follow-up questions. A React component, or a one-line mount anywhere else.",
      },
      {
        name: "Managed backend",
        desc:
          "Model calls, tool orchestration, and file handling run on AstralBeam. Nothing for you to deploy or scale.",
      },
      {
        name: "Fully customizable",
        desc:
          "Your title, copy, color scheme, and design tokens, or swap the header and empty state for your own components.",
      },
      {
        name: "Users' files",
        desc:
          "Users drop in screenshots, PDFs, spreadsheets, and code. The agent reads them and answers from them.",
      },
      {
        name: "Sandboxes and artifacts",
        desc:
          "Give the agent a sandbox to run code against uploaded data. The files it produces arrive as signed downloads.",
      },
      {
        name: "Resumable streaming",
        desc:
          "Reload mid-answer and the stream picks up where it left off, on the same device or another one.",
        soon: true,
      },
    ],
  },
  {
    index: "02",
    title: "IDENTIFY YOUR USERS",
    desc:
      "Your server already knows who is signed in. Mint a short-lived token that carries the user and their tenant, and the widget picks it up. API keys never reach the browser.",
    file: "api/astralbeam/token.ts",
    code: `import { createAstralBeamToken } from "@astralbeam/sdk/server"

export async function POST(request: Request) {
  const session = await getSession(request)
  const token = await createAstralBeamToken({
    apiKey: process.env.ASTRALBEAM_API_KEY,
    user: {
      id: session.user.id,
      name: session.user.name,
    },
    tenant: {
      id: session.org.id,
      name: session.org.name,
    },
  })
  return Response.json({ token })
}`,
    benefits: [
      {
        name: "Conversation history",
        desc:
          "Every user picks up their own threads, on any device, without you storing a message.",
        soon: true,
      },
      {
        name: "Rate limits",
        desc: "Per-customer and per-user limits, so one tenant can never drain another's budget.",
      },
      {
        name: "Usage tracking",
        desc: "Tokens, tool calls, and sandbox time, broken down by tenant and by user.",
        soon: true,
      },
      {
        name: "Metered billing",
        desc: "Charge for usage through Stripe, with plans, allowances, and overages.",
        soon: true,
      },
      {
        name: "Observability",
        desc: "One click to send traces to Langfuse, Braintrust, or your OpenTelemetry collector.",
        soon: true,
      },
      {
        name: "Tenant isolation",
        desc:
          "Organization and tenant boundaries are enforced in the database, not only at the API.",
      },
    ],
  },
  {
    index: "03",
    title: "CONNECT TOOLS & WIDGETS",
    desc:
      "Declare what the agent can do and what it can draw. Tools run in your page against your own state. Widgets render your components inside the reply.",
    file: "sidebar.tsx",
    code: `<AstralBeamChat
  tools={{
    refundOrder: defineTool({
      description: "Refund an order and notify the customer",
      parameters: z.object({ orderId: z.string() }),
      execute: ({ orderId }) => api.refund(orderId),
    }),
  }}
  widgets={{
    orderCard: defineWidget({
      description: "Show an order's status and total",
      parameters: z.object({ orderId: z.string() }),
      render: ({ orderId }) => <OrderCard id={orderId} />,
    }),
  }}
/>`,
    benefits: [
      {
        name: "Read user data",
        desc:
          "Tools run in the page with the user's own session, so the agent sees exactly what they see.",
      },
      {
        name: "Take actions",
        desc:
          "Refund, create, assign, send. The agent does the work inside your app, behind your permission checks.",
      },
      {
        name: "Interactive widgets",
        desc: "Render your own components inside the reply. State stays live in both directions.",
      },
      {
        name: "Ask before acting",
        desc: "The agent can pause and ask the user a structured question before it commits.",
      },
      {
        name: "Typed and validated",
        desc:
          "Zod, Valibot, ArkType, or plain JSON Schema. Input is validated before your code runs.",
      },
      {
        name: "Your app as an MCP server",
        desc:
          "Expose the same tools over MCP, so users can drive your app from Claude, ChatGPT, or Cursor.",
        soon: true,
      },
    ],
  },
]

interface Integration {
  label: string
  desc: string
  items: Array<{ name: string; soon?: boolean }>
}

export const integrations: Integration[] = [
  {
    label: "LLM PROVIDERS & GATEWAYS",
    desc: "Bring your own keys. Route through a gateway if you already have one.",
    items: [
      { name: "OpenAI" },
      { name: "Anthropic", soon: true },
      { name: "Google", soon: true },
      { name: "OpenRouter", soon: true },
      { name: "Vercel AI Gateway", soon: true },
    ],
  },
  {
    label: "OBSERVABILITY",
    desc: "Every run traced where your team already looks.",
    items: [
      { name: "Langfuse", soon: true },
      { name: "Braintrust", soon: true },
      { name: "LangSmith", soon: true },
      { name: "OpenTelemetry", soon: true },
    ],
  },
  {
    label: "CODING SANDBOXES",
    desc: "Pick a provider in the dashboard. The agent gets a workspace per conversation.",
    items: [
      { name: "Docker" },
      { name: "Daytona" },
      { name: "Vercel Sandbox" },
      { name: "Sprites" },
    ],
  },
  {
    label: "IDENTITY & BILLING",
    desc: "Your session is the source of truth. Usage rolls up into your billing.",
    items: [{ name: "Any auth provider" }, { name: "Stripe", soon: true }],
  },
]

const tokenPattern =
  /("[^"]*")|\b(import|from|export|async|function|return|await|const)\b|(<\/?)([A-Z][A-Za-z]*)|\b([A-Za-z_][\w.]*)(?=[=(])/gu

function highlightTokens(line: string) {
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of line.matchAll(tokenPattern)) {
    const [text, str, keyword, open, tag, fn] = match
    const key = String(match.index)
    if (match.index > cursor) nodes.push(line.slice(cursor, match.index))
    cursor = match.index + text.length

    if (str) nodes.push(<span className="t-str" key={key}>{str}</span>)
    else if (keyword) nodes.push(<span className="t-kw" key={key}>{keyword}</span>)
    else if (tag) {
      nodes.push(
        <Fragment key={key}>
          {open}
          <span className="t-tag">{tag}</span>
        </Fragment>,
      )
    } else if (fn) nodes.push(<span className="t-fn" key={key}>{fn}</span>)
    else nodes.push(text)
  }

  nodes.push(line.slice(cursor))
  return nodes
}

// Lines starting with `$ ` are shell commands and `+ ` lines are their output, matching the
// terminal's data-type styling. Everything else gets light TSX token coloring.
export function highlight(code: string) {
  return code.split("\n").map((line, index) => {
    const key = String(index)
    if (line.startsWith("$ ")) {
      return (
        <span className="t-line" data-type="cmd" key={key}>
          <span className="t-prompt">$</span>
          {` ${line.slice(2)}`}
        </span>
      )
    }
    if (line.startsWith("+ ")) {
      return <span className="t-line" data-type="out" key={key}>{line}</span>
    }
    return <span className="t-line" key={key}>{line === "" ? " " : highlightTokens(line)}</span>
  })
}
