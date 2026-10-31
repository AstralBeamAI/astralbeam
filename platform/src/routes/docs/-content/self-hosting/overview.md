# Overview

Run AstralBeam with PostgreSQL 18 and email delivery. File storage defaults to the local filesystem for new installations. Choose a [container or Linux binary deployment](./deploy.md), then complete configuration in the browser.

## What you run

One process serves the dashboard, `/configure`, the API, and these docs. Releases provide binaries for Linux, macOS, and Windows, plus Linux AMD64 and ARM64 images at `ghcr.io/astralbeamai/astralbeam-platform`. The binary bundles the server and static assets and needs no Bun installation on the host.

Source builds produce both the server bundle and `platform/.output/astralbeam-platform`. See [Deploy](./deploy.md#1-get-a-release-binary) for download and build commands.

## What you need alongside it

- PostgreSQL 18 or newer with the `citext` extension. PgBouncer is optional. See [Connection pooling](./operations.md#connection-pooling).
- A persistent directory writable by the application, or a private S3-compatible bucket and credentials. Production Compose supplies a persistent filesystem volume. Choose the provider in **File storage** at `/configure` or through the environment.
- An email path: an SMTP server, a Resend API key, or Amazon SES. Sign-up verification, password reset, password-change notices, and organization invitations all send mail.
- A reverse proxy that terminates TLS, unless explicitly opting into HTTP with `ALLOW_INSECURE=true`.
- A model provider for each organization. Owners or developers add connections in **Models**, enable models, and assign them to agents. Each connection stores its own credentials and API URL.

No separate queue or cache server is required.

For local contributor services, follow [repository setup](https://github.com/AstralBeamAI/astralbeam/blob/main/SETUP.md).

## Where state lives

PostgreSQL stores accounts, configuration, conversation history, and workflow state. The selected filesystem directory or private S3-compatible bucket stores file bytes. Back them up together, with the full encryption keyring kept separately. Follow [Backups and restore](./operations.md#backups-and-restore).

Deployment settings and provider credentials are encrypted with `DATABASE_ENCRYPTION_KEY`. See [encryption and rotation](./security.md#encryption-at-rest).

## Bootstrap variables and stored settings

Set `DATABASE_URL` for PostgreSQL and `DATABASE_ENCRYPTION_KEY` for encrypted settings and operator sign-in. These are the only required environment settings.

Edit other deployment settings at `/configure`. Uppercase environment overrides take precedence over stored values, including `STORAGE_PROVIDER` and `STORAGE_DIRECTORY` for file storage. Each organization manages model provider keys separately in the dashboard. See [Configuration](./configuration.md).

## First boot

The application opens when required configuration is valid and no bundled migration is pending. Clearing a required value or installing pending migrations closes that gate again.

While the gate is closed, application pages redirect to `/configure` and API routes answer `503` with a `Retry-After` header. Sign in at `/configure` with the first entry of `DATABASE_ENCRYPTION_KEY`, approve the pending migrations, and fill in the required settings. **Go to app** becomes available once configuration and owner onboarding are complete. [Deploy](./deploy.md) walks through the whole sequence.

## Running more than one replica

Replicas cache configuration, migration state, and sandbox leases independently:

- A save takes effect immediately only on the replica that handled it, so restart the others to make them reload it.
- Migration runs are serialized with a PostgreSQL advisory lock, so two replicas cannot apply migrations at the same time.
- A conversation routed to a different replica may get a fresh sandbox, because sandbox resume state does not cross processes.

**TIP**: Use sticky routing if you want a conversation to keep its sandbox.

## Versions and support

AstralBeam is pre-1.0. Only current `main` and the latest SDK release are supported. Security fixes ship in the next release, with no backports. Upgrade before reporting a problem.

Report a suspected vulnerability privately through [GitHub security advisories](https://github.com/AstralBeamAI/astralbeam/security/advisories/new) rather than a public issue. See [Security](./security.md).
