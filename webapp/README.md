# `@astralbeam/webapp`

TanStack Start application for the AstralBeam product.

The application owns its complete product stack, dependency lockfile, and project tooling configuration. Repository bootstrap, agent configuration, the development container, and local service orchestration remain at the repository root. The application does not depend on another AstralBeam project.

## Structure

- `public` — approved SVG logo masters, generated PNG variants, and other static files
- `src/components/auth` — ejected Better Auth UI feature components
- `src/components/ui` — shadcn-generated components
- `src/db` — server-only Drizzle client, schema, and migrations
- `src/emails` — React Email templates and Resend/SES delivery adapters
- `src/lib` — application utilities and server-only Better Auth configuration
- `src/routes` — public auth routes and protected application layouts
- `src/styles.css` — Tailwind, fonts, semantic theme mappings, and generated brand variables
- `src/theme` — pure theme compiler, concrete brand definition, schema, and tests

## Authentication

Better Auth is mounted at `/api/auth/*`. Existing users sign in at `/auth/sign-in`, new users accept the legal terms at `/auth/sign-up`, unassociated users create an organization at `/onboarding`, and the authenticated application lives at `/` with organization members and account/security settings.

The enabled methods are email/password, Google, and GitHub. Credential signup requires email verification; OAuth signup requires a verified provider identity and explicit signup intent. Organization invitations are emailed to the recipient and can be accepted only by the matching verified account.

Authenticated layouts provide first-render and reactive navigation protection, but they are not authorization boundaries. Better Auth APIs and server-only functions independently enforce sessions, organization membership, and configured organization permissions. Follow the repository [authentication setup](../SETUP.md#authentication-and-transactional-email) before testing these flows.

## Development tools

Start the application development server from this directory:

```sh
deno task dev
```

Open http://localhost:3000/dev for the development-tools hub. Utilities under `/dev` are available only in Vite development mode and return `404` from production builds. Add future local utilities to this namespace rather than starting a separate server.

### Email previews

Transactional email templates are pure React Email components under `src/emails/templates`. Preview-only sample data lives separately under `src/emails/previews`, with one typed fixture for each same-named template so production components never contain sample recipients or action URLs.

Open http://localhost:3000/dev/emails to inspect the exact production components rendered with fixed, synthetic fixture props. Each template also has a `?text=1` alternative for the derived plain-text payload. Preview assets use the current development-server origin, while action links use the reserved `.invalid` domain so an accidental click cannot touch local application data. Vite reloads template, fixture, shared email, and brand edits without a second process. The preview is intentionally static and script-free; use controlled sends to real clients or a dedicated rendering service when client-specific screenshots are required.

## Theme

The root route links the checked-in `src/styles.css` stylesheet. Its marked generated section supplies the light and dark semantic tokens, while the app theme controller applies system, light, or dark mode and persists the user's selection locally.

Generate checked-in logo output from this directory:

```sh
deno task generate:png
```

## Database

See the [database guide](src/db/README.md) for local service, migration, reset, and schema workflow details. Export schema modules from `src/db/schema.server.ts`, then generate and validate migrations from this directory:

```sh
deno task db generate --name=add-projects
deno task db check
deno task db migrate
```
