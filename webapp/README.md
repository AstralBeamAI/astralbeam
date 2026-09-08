# `@astralbeam/webapp`

TanStack Start application for the AstralBeam product.

For local development, follow [Setup](../SETUP.md). See [Architecture](../ARCHITECTURE.md) for the system overview and [Webapp development](AGENTS.md) for source layout and implementation rules.

## Authentication

Better Auth is mounted at `/api/auth/*`. Existing users sign in at `/auth/sign-in`, new users sign up at `/auth/sign-up` with legal acceptance when configured, unassociated users create an organization at `/onboarding`, and the authenticated application lives at `/` with organization members and account/security settings.

The enabled methods are email/password, Google, and GitHub. Credential signup requires email verification. OAuth signup requires a verified provider identity and explicit signup intent. Organization invitations are emailed to the recipient and can be accepted only by the matching verified account.

See [authentication setup](../SETUP.md#authentication-and-transactional-email) before testing these flows.

## Development tools

Run `deno task dev`, then open http://localhost:4500/dev. Email previews at http://localhost:4500/dev/emails use synthetic props and do not send email. Development routes return `404` in production.

## Theme

Choose system, light, or dark mode in the app. The selection is saved locally. Follow the root [theme instructions](../AGENTS.md#theme-and-brand) when changing theme inputs or logo masters:

```sh
deno task --cwd webapp generate:theme
deno task --cwd webapp generate:png
```

## Database

See the [database guide](src/db/README.md) for migration, reset, and sample-data commands.

From the repository root:

```sh
deno task --cwd webapp db generate --name=add-projects
deno task --cwd webapp db check
deno task --cwd webapp db migrate
```
