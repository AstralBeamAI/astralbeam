# Authentication package

`@astralbeam/auth` owns Better Auth configuration and reusable TanStack Start authentication utilities. Keep consumer setup and public API documentation in `README.md`.

## Boundaries

- Keep `src/auth.ts` server-only and import `@astralbeam/db` only there or from other server-only modules.
- Keep browser-safe code isolated in `src/auth-client.ts` and query definitions; never expose secrets or database imports through those modules.
- Preserve explicit package exports so consumers cannot accidentally import implementation files.
- Use `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and provider credentials from the environment; never commit credentials or package-local environment files.

## Authentication behavior

- Keep Google and GitHub OAuth as the only enabled sign-in methods unless product scope explicitly changes.
- Keep email/password and two-factor authentication disabled. Use Better Auth Organizations as the SaaS membership boundary; do not add teams or dynamic roles until product requirements need them.
- Keep organization deletion disabled until every organization-owned resource has an explicit, tested deletion or retention workflow.
- Keep rate limiting in shared database or secondary storage for multi-instance deployments; do not fall back to per-process memory in production.
- Keep `tanstackStartCookies()` last in the plugin array as required by the Better Auth TanStack integration.
- Treat route `beforeLoad` checks as navigation UX only. Protect organization-owned server functions with `organizationMiddleware`, using `freshOrganizationMiddleware` for sensitive or destructive operations; reserve `authMiddleware` for private operations that intentionally do not require an organization.

## Schema workflow

- Keep Better Auth and `@better-auth/drizzle-adapter` on the same exact 1.7 RC and use the `/relations-v2` adapter while Drizzle 1 is in use.
- Regenerate `packages/db/src/schema/auth.ts` with `vp run auth:generate` after any auth option or plugin changes; do not hand-edit generated output.
- Follow `packages/db/AGENTS.md` for relation merge order, migration generation, SQL inspection, and database validation.

## Validation

- Run the smallest relevant Vite+ checks while iterating, then verify the login, protected-route, and sign-out flow through browser computer use.
- Before publishing the change, run the repository's `ready` task once and inspect generated routes, migrations, and the complete diff.
