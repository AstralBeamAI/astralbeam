import type { APIRoute } from "astro"

import { siteMetadata, siteUrl } from "@/lib/site"

export const prerender = true

export const GET: APIRoute = ({ site }) => {
  const homeUrl = siteUrl("/", site?.href)
  const { app, docs, github, discord } = siteMetadata.links

  return new Response(
    `# AstralBeam

> AstralBeam is open source agent infrastructure: the agentic chat widget for your app.

Drop a Cursor-style agent sidebar into your product with one npm package and one component. It streams answers, calls your tools, renders your own components, and works with users' files. Self-host the platform or use AstralBeam Cloud. Items marked "in progress" are on the roadmap and not shipped yet.

## Integration

1. Add the frontend SDK (@astralbeam/sdk): Cursor-style agentic chat, managed backend, full customization of copy, colors, and slots, users' file attachments, coding sandboxes with downloadable artifacts, resumable streaming (in progress).
2. Identify your users: your server mints a short-lived token carrying the user and tenant. Unlocks per-customer and per-user rate limits, tenant isolation, and, in progress, conversation history, usage tracking, Stripe-metered billing, and one-click observability.
3. Hook up tools and widgets: the agent reads user data, takes actions inside your app, renders interactive widgets in its replies, asks before acting, and validates typed input. Exposing your app over MCP is in progress.

## Works with your stack

- LLM providers and gateways: OpenAI today, with Anthropic, Google, OpenRouter, and Vercel AI Gateway in progress.
- Observability: Langfuse, Braintrust, LangSmith, and OpenTelemetry, in progress.
- Coding sandboxes: Docker, Daytona, Vercel Sandbox, and Sprites.
- Identity and billing: any auth provider for identity, with Stripe billing in progress.

## Deployment

- The SDK is MIT licensed. The platform is AGPL-3.0.
- Self-host: one binary and a PostgreSQL database, with your own model keys and sandbox provider.
- AstralBeam Cloud: sign up, create an API key, and point the widget at app.astralbeam.ai.

## Links

- [Home](${homeUrl}): Product overview, integration steps, and deployment model.
- [Hosted app](${app}): Sign up for or log in to AstralBeam Cloud, the managed dashboard.
- [Documentation](${docs}): Guides and reference for the SDK and the platform.
- [Source code](${github}): The open-source platform under AGPL-3.0.
- [Discord](${discord}): Community chat with the AstralBeam team.

## Contact

For more information, contact ${siteMetadata.email}.
`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  )
}
