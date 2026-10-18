# Linearity example development

- Keep this a standalone TanStack Start consumer of the built SDK. Mock product data stays in the browser, and both workspaces are public. Basic Auth protects the playground, not real Tenant membership.
- Share issue validation and workspace checks across manual edits, Astro tools, and localStorage loading. Tool mutations update the readable store before returning.
- Remount Astro on workspace switches and reject stale-workspace tool calls. Reset retains the workspace and mounted assistant, using SDK reset to clear saved selection. Closing the panel preserves its conversation.
- Keep secrets in server environment variables without `VITE_`. Missing Basic Auth credentials fail closed in development and production.
- Own shadcn components locally and follow the root registry-provenance requirements. Keep generated export noise out of Knip without excluding unused-file discovery.
- Browser specs live in `e2e`. Live Astro tests require explicit `E2E_LIVE_ASTRO=true` and a configured local platform.
- Keep views and issues on workspace-scoped URLs. In-workspace navigation preserves Astro's conversation, and agent navigation validates the destination against that workspace.
- Verify host and sidebar together at 140% zoom. Recordings tell one real-world story with reading time and product narration. Reuse website titles, feature labels, and CTAs. Keep resets, reloads, and test mechanics in the functional suite.
