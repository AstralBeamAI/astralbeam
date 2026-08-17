# `@astralbeam/webapp`

TanStack Start application for the AstralBeam product.

## Authentication

The app mounts `@astralbeam/auth` at `/api/auth/$`, presents separate Shadcn Better Auth UI routes for existing-user sign-in at `/auth/sign-in` and terms-gated account creation at `/auth/sign-up`, onboards new users into a Better Auth organization at `/onboarding`, and protects `/dashboard` through session and active-membership checks. Authenticated users who open `/` are sent to `/dashboard`. Route guards control navigation; organization-owned server functions must independently apply organization middleware from `@astralbeam/auth/tanstack/middleware`.

The root provider connects Better Auth UI to TanStack Router and mounts the Shadcn Base UI toast. The checked-in auth components live in `@astralbeam/ui`; keep their Shadcn provenance and `Local edits` comments current when regenerating them.

## Theme ownership

The root route places the checked-in `@astralbeam/brand/colors.css` stylesheet in the server-rendered document head and applies `.light` before first paint. This keeps the default theme available without shipping the Theme resolver in the client bundle.

Organization lookup, persistence, fallback, and request handling belong at the application boundary. Convert organization definitions with `@astralbeam/theme` on the server and deliver the selected CSS through the same document-head path.
