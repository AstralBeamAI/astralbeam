# Authentication follow-up plan

This plan contains only near-term authentication work that is not part of the current implementation.

## 1. Validate runtime configuration

Add an explicit server-only runtime-configuration export to `@astralbeam/utils`. Validate `DATABASE_URL`, Better Auth settings, and OAuth provider credentials with Effect 4, keep secrets redacted in errors, and replace raw `process.env` reads and non-null assertions in runtime packages.

Keep `@astralbeam/utils/environment` limited to loading repository-root development files for Vite, Astro, Better Auth CLI, and Drizzle Kit. Shell, CI, and deployment values must continue to win over file values.

Completion criteria:

- Server code imports a validated, server-only configuration API instead of reading individual secrets directly.
- Missing or invalid configuration fails with variable names but never secret values.
- Development, test, build, and database tooling each have a documented configuration-loading test.

## 2. Add handler-level authentication coverage

Build a disposable PostgreSQL-backed fixture around the Better Auth handler and server middleware.

Required scenarios:

- Existing users can sign in through Google or GitHub without requesting sign-up.
- Unknown users cannot be created from the sign-in page because both providers disable implicit sign-up.
- Sign-up rejects a missing, false, stale, or malformed terms acknowledgement and records the current terms version after a valid request.
- Organization creation establishes an active membership, and switching organizations changes the active organization.
- Cached middleware rejects missing sessions and memberships, while fresh middleware detects revoked sessions and changed active organizations immediately.

## 3. Finish protected-route behavior

Keep `beforeLoad` as the server-rendered navigation guard, then add Better Auth UI's reactive `useAuthenticate` pattern to the protected layout so expiry, revocation, and cross-tab sign-out redirect while the page remains mounted. Preserve and validate `redirectTo` so successful authentication can return users to an allowed same-origin private route without creating an open redirect.

Completion criteria:

- Initial server rendering never exposes private UI to an unauthenticated user.
- Losing a session after mount removes private UI and redirects to sign-in.
- Successful authentication returns to an allowed same-origin destination.
- Every private server function remains independently protected by authentication or organization middleware.
