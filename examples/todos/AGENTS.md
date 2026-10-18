# Todos example development

- Keep this a standalone consumer of the built SDK through `workspace:*`, with plain CSS, no Tailwind or shadcn. Customize through existing SDK props, extending them only when necessary.
- Keep Todos, Users, and Conversations as separate pages in one shared layout with a persistent assistant and appearance controls.
- Use plain data and helpers with explicit options, not classes or closure-based state factories. Routes compose components. Keep reusable UI one component per file in `src/components`, subscriptions in `src/hooks`, and cohesive helpers in responsibility-named files.
- Centralize configuration and brand labels in `src/lib/config.ts` or `config.server.ts`. Keep all server-only code in `*.server.ts` and out of client modules. Colocate unit tests under `src`.
- Before editing browser tests, follow [e2e/README.md](e2e/README.md). Keep configuration loading independent of application startup.
- Keep `mintSeedChatAuthToken(apiKey: string)` fixed to the default seed identity. Other users must select existing fixtures and use the built server SDK, never identity or permission overrides on this helper.
- Keep user listing tenant-scoped and reuse the chat token endpoint. Exercise organization scope only in browser fixtures, without adding an organization-token endpoint or tenant directory page.
