# Overview

Run AstralBeam on your own infrastructure. The standalone setup prepares a local database, persistent file storage, and sandbox. Choose your installation:

- [Standalone binary](./deploy.md#standalone-binary) to install and start the platform.
- [Docker Compose](./deploy.md#docker-compose) for a local evaluation.

## What you run

One application serves the dashboard, API, docs, and operator setup page at `/configure`. Use a release binary or the Linux container image at `ghcr.io/astralbeamai/astralbeam-platform`. The binary includes the server and static assets, so the host needs no Bun installation.

## What you need alongside it

- A persistent directory writable by the application. Keep it across upgrades.
- SMTP, Resend, or Amazon SES for account verification, password recovery, and invitations.
- An HTTPS reverse proxy for public hosting.
- A model-provider API key, added under **Models** in each organization's dashboard.

Standalone setup uses experimental embedded PostgreSQL. For multiple hosts, provide PostgreSQL 18 or newer and shared S3-compatible storage. No separate queue or cache server is required.

For local contributor services, follow [repository setup](https://github.com/AstralBeamAI/astralbeam/blob/main/docs/SETUP.md).

## Where state lives

PostgreSQL stores accounts, configuration, conversation history, and workflow state. The selected filesystem directory or private S3-compatible bucket stores file bytes. Back them up together, with the full encryption keyring kept separately. Follow [Backups and restore](./operations.md#backups-and-restore).

`DATABASE_ENCRYPTION_KEY` protects stored settings and provider credentials. Keep it private and back it up: losing it can make those values unrecoverable. See [encryption and rotation](./security.md#encryption-at-rest).

## Bootstrap variables and stored settings

Standalone bootstrap saves private startup settings in `.env` and generates an encryption key for the local database. Use that key to sign in to `/configure` and edit deployment settings. Environment overrides take precedence over saved values. See [Configuration](./configuration.md).

## First boot

Open `/configure`, review any pending migrations, complete the required settings, and invite the owner. **Go to app** becomes available when setup is complete. Application pages redirect to `/configure` and API routes return `503` until the required configuration and migrations are ready. Follow [Complete setup](./deploy.md#complete-setup).

Next, follow the [Quickstart](/docs/start/quickstart), using your deployment's `/api` URL for the SDK's `apiUrl`.

## Running more than one replica

Replicas need the same database, encryption keyring, and shared file storage. A conversation routed to another process may get a fresh sandbox. For sandbox continuity, use `WORKERS=1` with sticky routing between separately started binaries. See [HTTP workers](./operations.md#http-workers) and [cluster operations](./operations.md#cluster-readiness-and-recovery) before adding replicas.

## Versions and support

AstralBeam is pre-1.0. Only current `main` and the latest SDK release are supported. Security fixes ship in the next release, with no backports. Upgrade before reporting a problem.

Report a suspected vulnerability privately through [GitHub security advisories](https://github.com/AstralBeamAI/astralbeam/security/advisories/new) rather than a public issue. See [Security](./security.md).
