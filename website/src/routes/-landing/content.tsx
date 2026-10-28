import { Fragment, type ReactNode } from "react"

import {
  ChartIcon,
  ChatIcon,
  CheckIcon,
  FileIcon,
  PlugIcon,
  ServerIcon,
  ShieldIcon,
  SlidersIcon,
  WidgetIcon,
} from "@/components/icons"

interface Benefit {
  name: string
  desc: string
  icon?: ReactNode
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
    desc: "Install the SDK and mount the agent chat in your app. Stream replies, upload files, and match your app’s styles.",
    file: "sidebar.tsx",
    code: `$ npm install @astralbeam/sdk
+ added 1 package

import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <AstralBeamChat
      title="Acme Assistant"
      theme={{
        light: { "--primary": "#4f46e5", "--radius": "0.75rem" },
        dark: { "--primary": "#818cf8" },
      }}
    />
  )
}`,
    benefits: [
      {
        name: "Cursor-style agentic chat",
        desc: "Streaming replies, visible tool calls, and follow-up questions. A React component, or a one-line mount anywhere else.",
        icon: <ChatIcon />,
      },
      {
        name: "Fully customizable",
        desc: "Your title, copy, color scheme, and design tokens, or swap the header and empty state for your own components.",
        icon: <SlidersIcon />,
      },
      {
        name: "Files and artifacts",
        desc: "Upload files, work with their contents, and download generated results.",
        icon: <FileIcon />,
      },
      {
        name: "Managed backend",
        desc: "Model calls, tool orchestration, and file handling run on AstralBeam Cloud. No agent backend for you to deploy or scale.",
        icon: <ServerIcon />,
      },
    ],
  },
  {
    index: "02",
    title: "IDENTIFY YOUR USERS",
    desc: "Your server already knows who is signed in. Mint a short-lived token that carries the user and their tenant, and the widget picks it up. API keys never reach the browser.",
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
        desc: "Every user picks up their own threads, on any device, without you storing a message.",
        icon: <ChatIcon />,
      },
      {
        name: "Usage limits",
        desc: "Set token or spend limits per tenant, user, or conversation, with allowances that reset on your schedule.",
        icon: <SlidersIcon />,
      },
      {
        name: "Usage tracking",
        desc: "See token usage and model spend against each allowance, broken down by tenant, user, or conversation.",
        icon: <ChartIcon />,
      },
      {
        name: "Tenant isolation",
        desc: "Keep each tenant's conversations and files separate, with access checked for every user.",
        icon: <ShieldIcon />,
      },
    ],
  },
  {
    index: "03",
    title: "CONNECT TOOLS & WIDGETS",
    desc: "Declare what the agent can do and what it can show. Tools run in your page against your own state. Widgets render your components inside the reply.",
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
        name: "Read data and take actions",
        desc: "Tools use the user's session to read data and act inside your app, behind your permission checks.",
        icon: <CheckIcon />,
      },
      {
        name: "Interactive widgets",
        desc: "Render your own components inside the reply, connected to your app's live state.",
        icon: <WidgetIcon />,
      },
      {
        name: "Validation and approvals",
        desc: "Validate inputs with your schemas and ask users a structured question before taking action.",
        icon: <SlidersIcon />,
      },
      {
        name: "MCP connections",
        desc: "Connect remote MCP servers and let users authorize the tools their agent can use.",
        icon: <PlugIcon />,
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
      { name: "Anthropic" },
      { name: "Google Gemini" },
      { name: "xAI Grok" },
      { name: "OpenRouter" },
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
      { name: "OpenTelemetry" },
    ],
  },
  {
    label: "CODING SANDBOXES",
    desc: "Pick a provider in the dashboard. The agent gets a workspace per conversation.",
    items: [
      { name: "Docker" },
      { name: "Daytona" },
      { name: "E2B" },
      { name: "Vercel Sandbox" },
      { name: "Sprites" },
    ],
  },
  {
    label: "IDENTITY & BILLING",
    desc: "Your session is the source of truth. Set per-customer token and spend limits.",
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

    if (str)
      nodes.push(
        <span className="t-str" key={key}>
          {str}
        </span>,
      )
    else if (keyword)
      nodes.push(
        <span className="t-kw" key={key}>
          {keyword}
        </span>,
      )
    else if (tag) {
      nodes.push(
        <Fragment key={key}>
          {open}
          <span className="t-tag">{tag}</span>
        </Fragment>,
      )
    } else if (fn)
      nodes.push(
        <span className="t-fn" key={key}>
          {fn}
        </span>,
      )
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
      return (
        <span className="t-line" data-type="out" key={key}>
          {line}
        </span>
      )
    }
    return (
      <span className="t-line" key={key}>
        {line === "" ? " " : highlightTokens(line)}
      </span>
    )
  })
}
