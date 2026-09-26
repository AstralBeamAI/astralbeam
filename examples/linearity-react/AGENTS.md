# Linearity example development

- Keep this app a standalone TanStack Start consumer of the built SDK through `file:../../sdk`. Use Deno for all commands.
- Keep mock product data in the browser. Both workspaces are available to every visitor. Basic Auth protects the playground, not membership in real Tenants.
- Keep issue validation and workspace membership checks shared between manual edits, Astro tools, and localStorage loading. Tool mutations must update the readable store before returning, so consecutive tool calls see each other's changes.
- Remount Astro on workspace switches and Reset, and reject tool calls captured for a workspace that is no longer active. Closing the panel should preserve its conversation.
- Keep secrets in server environment variables without a `VITE_` prefix. Missing Basic Auth credentials must fail closed in development and production.
- This example owns its shadcn components under `src/components/ui`. Add them with `deno task ui add <component>` and record the command and intentional changes in each generated file. Keep generated export noise out of Knip while retaining unused-file discovery.
- Keep browser specs under `e2e` and run them with `deno task e2e`. Save screenshots, videos, and reports outside the worktree. Live Astro tests require explicit `E2E_LIVE_ASTRO=true` and a configured local platform.
