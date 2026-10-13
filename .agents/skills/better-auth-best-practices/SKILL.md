---
name: better-auth-best-practices
description: Implement, review, migrate, and secure Better Auth servers, clients, sessions, database adapters, OAuth flows, and plugins. Use for Better Auth authentication setup, account creation, session security, trusted origins, rate limiting, or auth hardening, including work on its auth.ts.
compatibility: Requires network access to consult the current Better Auth documentation.
---

# Better Auth

Use maintained Better Auth sources instead of relying on copied API details. Start with the installed package version and the project's product and security constraints.

## Read the relevant current source

- Use the [documentation index](https://better-auth.com/docs), [LLMs.txt](https://better-auth.com/llms.txt), or [documentation MCP](https://better-auth.com/docs/ai-resources/mcp) to find current examples.
- Resolve the installed version from the lockfile, falling back to the manifest when needed. Follow the matching release index in [LLMs.txt](https://better-auth.com/llms.txt), using the installed release's documentation for current behavior and the target release's documentation for upgrade work. Confirm prerelease APIs against that release's types or source.
- Read [installation](https://better-auth.com/docs/installation) and the relevant [integration](https://better-auth.com/docs/integrations) when creating or wiring an instance.
- Read [database](https://better-auth.com/docs/concepts/database) and [CLI](https://better-auth.com/docs/concepts/cli) before schema generation or migration work.
- Read [security](https://better-auth.com/docs/reference/security), [options](https://better-auth.com/docs/reference/options), and [rate limiting](https://better-auth.com/docs/concepts/rate-limit) for every security review or production change.
- Read [OAuth](https://better-auth.com/docs/concepts/oauth), [sessions](https://better-auth.com/docs/concepts/session-management), or the selected [plugin](https://better-auth.com/docs/plugins) only when the task touches that feature.
- For additional authentication review guidance, consult Better Auth's maintained [agent-skill pack](https://github.com/better-auth/skills).

## Workflow

1. Inspect the installed Better Auth version, package manager, framework, runtime, database layer, existing auth configuration, migrations, environment policy, and repository instructions.
2. Preserve explicit product scope. Do not enable a sign-in method, automatic signup, account linking, organization feature, or plugin merely because Better Auth supports it.
3. Configure the server instance, adapter, selected plugins, and framework handler from the matching current docs. Keep server-only modules out of browser bundles and keep framework cookie integration in the documented plugin order.
4. Configure the client with only the matching client plugins and infer types from the server instance when the package boundary allows it.
5. Regenerate the auth schema after adapter, model, field, or plugin changes. Apply it through the repository's migration workflow and inspect generated SQL without schema push.
6. Review every server operation independently for authentication, fresh-session requirements, authorization, organization scoping, and safe redirect handling. Navigation guards are not authorization.
7. Exercise the handler and affected user flow, then run the smallest relevant type, schema, migration, and build checks.

## Security invariants

- Treat all client-supplied profile fields, callback URLs, OAuth `additionalData`, organization identifiers, and authorization claims as untrusted. Validate before use. Carry server-derived OAuth state through the documented server context.
- Keep secrets and provider credentials server-only, require a stable production base URL, and allow only necessary exact origins. Do not disable CSRF or origin checks to make an integration pass.
- Trust forwarded host, protocol, or IP headers only behind a proxy that overwrites them and prevents direct origin access.
- Use persistent or shared rate-limit storage for horizontally scaled or serverless production. Keep stricter rules on sensitive endpoints.
- Keep security-owned user fields non-input, encrypt stored OAuth tokens when retained, and avoid cross-subdomain cookies unless every subdomain is trusted.
- Make sensitive or destructive operations require a fresh session where supported. Re-check authorization and organization membership at the server boundary instead of trusting cached client state.
- Never log secrets, tokens, raw cookies, authorization codes, or unnecessary personal data. Keep user-facing authentication errors enumeration-safe.
