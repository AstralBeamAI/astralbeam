# `@astralbeam/auth`

Shared Better Auth integration for AstralBeam's TanStack Start applications. It supports Google and GitHub OAuth, prevents implicit OAuth registration, and uses Better Auth Organizations as the SaaS membership boundary.

## Configure local OAuth

Follow the repository's step-by-step [Google and GitHub OAuth setup guide](../../SETUP.md#configure-google-and-github-oauth). It owns the provider-console instructions, callback URLs, environment variables, local verification flow, and production checklist.

## Public API

- `@astralbeam/auth/auth` exports the server-only Better Auth instance and inferred session/user types.
- `@astralbeam/auth/auth-client` exports the same-origin React client.
- `@astralbeam/auth/terms` exports the current terms version used by the sign-up UI and server-side acceptance check.
- `@astralbeam/auth/tanstack/functions` and `@astralbeam/auth/tanstack/queries` expose the shared session query using Better Auth UI's cache key.
- `@astralbeam/auth/tanstack/middleware` exposes cached and database-fresh authentication and organization-membership middleware for protected server functions.

Route guards improve navigation behavior but do not authorize data access. Apply `organizationMiddleware` to organization-owned server functions and `freshOrganizationMiddleware` to sensitive or destructive operations. Use `authMiddleware` only for authenticated operations that intentionally exist outside an organization.

Existing users call social sign-in without a sign-up request. New users must start at `/auth/sign-up`, accept the current terms, and explicitly request OAuth sign-up; the server validates that OAuth state and records the accepted version and timestamp before creating the user.

New users continue to `/onboarding` to create their first organization. Better Auth stores the active organization on the session and verifies membership before organization middleware exposes an organization ID to application code. Organization deletion stays disabled until the product has an explicit organization-data deletion workflow. Future organization-owned tables must carry that organization ID and add PostgreSQL row-level security as defense in depth.

Better Auth stores production rate-limit counters in PostgreSQL so limits remain consistent across application instances. Move them to shared secondary storage only when the deployment has an application-owned Valkey integration.

## Regenerate the schema

After changing Better Auth configuration or plugins, run `vp run auth:generate`, inspect the generated Drizzle schema, then follow the migration workflow in [`@astralbeam/db`](../db/README.md).

This integration is pinned to Better Auth `1.7.0-rc.5` for the Drizzle Relations v2 adapter introduced while resolving [better-auth/better-auth#6766](https://github.com/better-auth/better-auth/issues/6766). Its structure was compared against [mugnavo/tanstarter-monorepo at `5dc3b9d`](https://github.com/mugnavo/tanstarter-monorepo/tree/5dc3b9d7e9150c20543fe24cb4a5f7c57e789cd9).

Near-term runtime configuration, handler coverage, and protected-route work is tracked in the [authentication follow-up plan](../../docs/auth-platform.plan.md).
