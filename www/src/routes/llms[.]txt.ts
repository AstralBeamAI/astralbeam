import { createFileRoute } from "@tanstack/react-router"

import { blogPosts } from "@/lib/blog"
import { siteMetadata, siteUrl } from "@/lib/site"

const { logIn, docs, github, discord } = siteMetadata.links
const llmsText = `# AstralBeam

> AstralBeam adds an agentic chat widget to your app in minutes.

${siteMetadata.description} Self-host the platform or use AstralBeam Cloud. Items marked "in progress" are on the roadmap and not shipped yet.

## Integration

1. Add the frontend SDK (@astralbeam/sdk): Cursor-style agentic chat, managed backend, full customization of copy, colors, and slots, users' file attachments, coding sandboxes with downloadable artifacts, resumable streaming (in progress).
2. Identify your users: your server mints a short-lived token carrying the user and tenant. Unlocks conversation history, token and spend limits, usage tracking by tenant, user, or conversation, and tenant isolation.
3. Hook up tools and widgets: the agent reads user data, takes actions inside your app, renders interactive widgets in its replies, asks before acting, and validates typed input. Users can authorize remote MCP connections to give their agent more tools.

## Works with your stack

- LLM providers and gateways: OpenAI, Anthropic, Google Gemini, xAI Grok, and OpenRouter. Vercel AI Gateway is in progress.
- Observability: Langfuse, Braintrust, LangSmith, and OpenTelemetry, in progress.
- Coding sandboxes: Docker, Daytona, E2B, Vercel Sandbox, and Sprites.
- Identity and billing: any auth provider for identity, with Stripe billing in progress.

## Deployment

- The SDK is MIT licensed. The platform is AGPL-3.0.
- Self-host: one binary, a PostgreSQL database, and a private S3-compatible bucket, with your own model keys and sandbox provider. See the self-hosting guide for complete infrastructure requirements.
- AstralBeam Cloud: sign up, create an API key, and point the widget at astralbeam.ai.

## Links

- [Home](${siteUrl("/")}): Product overview, integration steps, and deployment model.
- [Hosted app](${siteUrl(logIn)}): Sign up for or log in to AstralBeam Cloud, the managed dashboard.
- [Documentation](${siteUrl(docs)}): Guides and reference for the SDK and the platform.
- [CLI and coding agents](${siteUrl("/docs/cli/coding-agents")}): Install the CLI skill and configure agent access.
- [Blog](${siteUrl("/blog")}): Notes on building agents and their interfaces.
${blogPosts.map((post) => `- [${post.title}](${siteUrl(post.path)}): ${post.description}`).join("\n")}
- [Source code](${github}): The open-source platform under AGPL-3.0.
- [Discord](${discord}): Community chat with the AstralBeam team.

## Contact

For more information, contact ${siteMetadata.email}.
`

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(llmsText, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
})
