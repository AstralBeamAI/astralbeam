import type { APIRoute } from "astro"

import { siteMetadata, siteUrl } from "@/lib/site"

export const prerender = true

export const GET: APIRoute = ({ site }) => {
  const homeUrl = siteUrl("/", site?.href)

  return new Response(
    `# AstralBeam

> AstralBeam is open source AI infrastructure for shipping agents in minutes, not months.

Drop in the AstralBeam frontend SDK, and AstralBeam handles agentic chat, streaming, history, tools, metering, billing, and auth. Application teams get one service instead of stitching together an LLM gateway, an agent framework, observability, tools and MCP plumbing, billing, authentication, and evaluations.

## Features

- Frontend SDK (@astralbeam/sdk): a fully-customizable, Cursor-like agent sidebar with your own UI widgets
- Managed backend: resumable chat streaming, conversation history, and observability, with nothing to run
- Tools, skills, and MCP: app actions, user-provided MCP servers, and real actions inside your product
- Metered billing and rate limits: per-customer rate limits and token-metered billing wired to Stripe
- Enterprise-ready: organization-aware SSO, data privacy, and access control built in from day one
- Prompts and evals: prompt editing, A/B tests, and scoring of live conversations from a web UI

## Deployment

- Self-host the open-source AGPL-3.0 platform on your own infrastructure.
- Use AstralBeam Cloud for managed infrastructure and maintenance.
- Start with the entire platform, or adopt it incrementally, piece by piece.
- Built on open protocols: AG-UI, MCP, and A2A.

## Links

- [Home](${homeUrl}): Product overview, features, deployment model, and early-access waitlist.
- [Source code](https://github.com/astralbeamai/astralbeam): The open-source platform under AGPL-3.0.

## Contact

For more information, contact ${siteMetadata.email}.
`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  )
}
