import type { APIRoute } from "astro"

export const prerender = true

export const GET: APIRoute = ({ site }) => {
  const homeUrl = new URL("/", site).href

  return new Response(
    `# AstralBeam

> AstralBeam is open-source infrastructure for shipping agents in minutes, not months.

Adding agents to an app today involves patching together frontend libraries, backend frameworks, LLM providers, observability tools, billing, auth, and eval infrastructure. AstralBeam is a single service developers can integrate so they can build the agent user experience in the frontend without writing backend agent infrastructure.

AstralBeam can be self-hosted or used through AstralBeam Cloud. AstralBeam is accepting early design partner applications.

## Product Focus

- Drop-in frontend SDK for a fully customizable Cursor-like agent sidebar UI
- Tenant-aware auth, permissions, user context, and product data adapters
- Fully managed infrastructure for durable chat streaming, conversation history, observability, analytics, and audit logs
- Tools, skills, app actions, user-added MCP support, guardrails, and eval hooks
- Per-customer flexible rate limits and token-based billing integrated with Stripe
- Multi-tenant enterprise-grade SSO, data privacy, and access control
- Prompt management, A/B testing, and production evals for non-technical users
- Multiplayer chat, background agents, dynamic LLM routing, token optimization, and prompt caching

## Pages

- [Home](${homeUrl}): Product landing page for AstralBeam.

## Contact

For more information, contact hello@astralbeam.ai.
`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  )
}
