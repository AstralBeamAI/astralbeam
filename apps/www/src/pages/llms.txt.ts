import type { APIRoute } from "astro"

import { siteMetadata, siteUrl } from "@/lib/site"

export const prerender = true

export const GET: APIRoute = ({ site }) => {
  const homeUrl = siteUrl("/", site?.href)

  return new Response(
    `# AstralBeam

> AstralBeam is open-source infrastructure for shipping agents in minutes, not months.

AstralBeam gives application teams one service for adding production-ready agents instead of assembling separate frontend, backend, model, observability, billing, authentication, and evaluation systems.

## Product Focus

- Drop-in frontend SDK for a customizable, Cursor-like agent sidebar
- Managed resumable chat streaming, conversation history, observability, analytics, and audit logs
- Tools, skills, app actions, user-provided MCP support, guardrails, and evaluation hooks
- Tenant-aware authentication, permissions, context, flexible rate limits, and token-based billing
- Enterprise SSO, data privacy, access control, prompt management, A/B testing, and production evaluations
- Multiplayer chat, background agents, dynamic model routing, prompt caching, and token optimization

## Deployment

- Self-host the open-source AGPL-3.0 platform on your own infrastructure.
- Use AstralBeam Cloud for managed infrastructure and maintenance.
- Adopt the modular platform incrementally through open standards.

## Pages

- [Home](${homeUrl}): Product overview, capabilities, deployment model, and early-access waitlist.

## Contact

For more information, contact ${siteMetadata.email}.
`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  )
}
