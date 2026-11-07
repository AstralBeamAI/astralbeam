import { createFileRoute } from "@tanstack/react-router"

import { blogPosts } from "@/lib/blog"
import { siteMetadata, siteUrl } from "@/lib/site"

const { logIn, docs, github, discord } = siteMetadata.links
const llmsText = `# AstralBeam

> AstralBeam lets developers add agentic chat to their web apps in minutes.

${siteMetadata.description} Self-host the platform or use AstralBeam Cloud. Items marked "in progress" are on the roadmap and not shipped yet.

AstralBeam is for developers and product teams building SaaS and multi-tenant apps who want to add an AI assistant to their product. It brings the chat UI, model calls, tool orchestration, conversation history, and file handling together, while developers connect their app's data and actions and retain their own permission checks. It is open source, supports your own model provider keys, and can run on your infrastructure.

## Integration

1. Add the frontend SDK (@astralbeam/sdk): Cursor-style agentic chat, managed backend, full customization of copy, colors, and slots, users' file attachments, coding sandboxes with downloadable artifacts, resumable streaming (in progress).
2. Identify your users: your server mints a short-lived token carrying the user and tenant. Unlocks conversation history, token and spend limits, usage tracking by tenant, user, or conversation, and tenant isolation.
3. Hook up tools and widgets: let the agent take actions in your app and display UI widgets in chat. Define input schemas and approval flows, and authorize tool actions on your backend. Users can authorize remote MCP connections to give their agent more tools.

## Works with your stack

- LLM providers and gateways: OpenAI, Anthropic, Google Gemini, xAI Grok, and OpenRouter. Vercel AI Gateway is in progress.
- Observability: OpenTelemetry. Langfuse, Braintrust, and LangSmith are in progress.
- Coding sandboxes: Docker, Daytona, E2B, Vercel Sandbox, and Sprites.
- Identity and billing: any auth provider for identity, with Stripe billing in progress.

## Deployment

- The SDK is MIT licensed. The platform is AGPL-3.0.
- Self-host: one binary or container, PostgreSQL 18+, email delivery, and a persistent file directory or private S3-compatible bucket. Use your own model keys and connect a sandbox provider when you need code execution. See the self-hosting guide for complete infrastructure requirements.
- AstralBeam Cloud: sign up, connect a model provider, create an organization API key, and follow the quickstart to connect your app's authentication and mount the widget.

## Links

- [Home](${siteUrl("/")}): Product overview, integration steps, and deployment model.
- [Quickstart](${siteUrl("/docs/start/quickstart")}): Configure a model, connect your existing login, and stream the first reply inside your app.
- [Pricing](${siteUrl("/home#pricing")}): Cloud, managed hosting, and self-hosting rates.
- [Hosted app](${siteUrl(logIn)}): Sign up for or log in to AstralBeam Cloud, the managed dashboard.
- [Documentation](${siteUrl(docs)}): Guides and reference for the SDK and the platform.
- [Agent Skill](${siteUrl("/agent-skills/astralbeam/SKILL.md")}): Instructions for integrating AstralBeam and verifying replies and application tools.
- [Agent authentication and MCP](${siteUrl("/auth.md")}): Connect an agent to the organization API at /mcp using an organization API key.
- [Agent instructions](${siteUrl("/agents.md")}): Organization API workflow, identity boundaries, and app-integration resources.
- [Coding agents](${siteUrl("/docs/cli/coding-agents")}): Use the integration skill in your app's repository, or configure CLI access for organization administration.
- [Self-hosting](${siteUrl("/docs/self-hosting/deploy")}): Deploy a container or install the matching Platform binary with install.sh.
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
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
        }),
    },
  },
})
