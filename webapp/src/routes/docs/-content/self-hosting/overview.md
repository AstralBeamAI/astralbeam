# Overview

A self-hosted AstralBeam is one web application process in front of one PostgreSQL database. Read this page first, then follow [Deploy](./deploy.md) to install it, [Configuration](./configuration.md) for every setting, [Operations](./operations.md) for day-two work, and [Security](./security.md) for hardening.

Every command below runs from the repository root in the `deno task --cwd webapp <task>` form. Contributor setup lives in `SETUP.md` and the system design in `ARCHITECTURE.md`.

## What you run

A single process serves the dashboard, the operator page at `/configure`, the public API under `/api`, and these docs. Two artifacts come out of the same build.

| Artifact           | Command                          | What it is                                                                                                               |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Server bundle      | `deno task --cwd webapp build`   | `webapp/.output/server/index.mjs` plus static assets in `webapp/.output/public`, run with `deno task --cwd webapp start` |
| Single-file binary | `deno task --cwd webapp compile` | `webapp/.output/astralbeam`, a Deno executable with the server bundle and its assets embedded                            |

`compile` embeds whatever the last `build` left in `.output`, so `build` always runs first. Each tagged release publishes one prebuilt Linux x86_64 binary. There is no Dockerfile for the application and no published container image.

## What you need alongside it

- PostgreSQL 18 or newer. The schema depends on server-side `uuidv7()` defaults and the `citext` extension.
- A transaction-pooling connection pooler such as PgBouncer. The reference Compose setup runs one, and the application sends prepared queries, so the pooler needs a prepared statement allowance. The reference setup sets `MAX_PREPARED_STATEMENTS: 200`.
- An email path: an SMTP server, a Resend API key, or Amazon SES. Sign-up verification, password reset, password-change notices, and organization invitations all send mail.
- A reverse proxy that terminates TLS. Production requires HTTPS.
- An OpenAI API key. Chat requests fail until one is configured.

Nothing else is required. There is no object storage, no queue, and no separate cache server. The development Compose file also starts Valkey and Mailpit, but no application code uses Valkey, and Mailpit is a local sink that captures mail instead of delivering it.

## Where state lives

Everything is a row in the one PostgreSQL database. Back that database up and you have backed up the deployment.

| Tables                                       | State                                                    |
| -------------------------------------------- | -------------------------------------------------------- |
| `user`, `account`, `session`, `verification` | Dashboard identity and authentication                    |
| `organization`, `member`, `invitation`       | Customer organizations and their employees' access       |
| `api_key`                                    | Organization API key digests, lifecycle, and quotas      |
| `agent`, `organization_configuration`        | Agent definitions and each organization's default agent  |
| `sandbox_provider`                           | Named sandbox providers and their encrypted credentials  |
| `tenant`, `tenant_user`                      | Your customers' external identities and metadata         |
| `config`                                     | Encrypted deployment settings edited at `/configure`     |
| `rate_limit`                                 | Shared authentication, operator login, and chat counters |
| `drizzle.__drizzle_migrations`               | Which migrations have been applied                       |

`config.value` and `sandbox_provider.credentials` hold ciphertext encrypted with keys derived from `DATABASE_ENCRYPTION_KEY`. A database dump is unusable without that value.

## Bootstrap variables and stored settings

Two environment variables are required, and nothing else has to be in the environment.

| Variable                  | Purpose                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`            | PostgreSQL connection URL, normally pointing at the pooler                          |
| `DATABASE_ENCRYPTION_KEY` | Comma-separated keyring that encrypts stored secrets and authenticates the operator |

Every other setting, including the base URL, the authentication secret, CAPTCHA keys, OAuth clients, email delivery, and the OpenAI key, is a row in the `config` table that an operator edits in the browser at `/configure`. Any of those settings can also be supplied as an uppercase environment variable, which then wins over the stored value. See [Configuration](./configuration.md).

## First boot

The application stays gated until two conditions hold at once: configuration reports no issues, and no bundled migration is pending. There is no stored setup-complete flag, so the same gate reopens if a required setting is later cleared or a new release adds a migration.

While the gate is closed, page routes redirect to `/configure` and API routes answer `503` with a `Retry-After` header. Sign in at `/configure` with the first entry of `DATABASE_ENCRYPTION_KEY`, approve the pending migrations, fill in the required settings, and the application opens to users immediately on that process.

## Running more than one replica

Each process caches its own configuration snapshot, migration state, and sandbox leases. That has three consequences.

- After saving configuration on one replica, restart the others so they reload it. The save takes effect immediately only on the replica that handled it.
- Migration runs are serialized with a PostgreSQL advisory lock, so two replicas cannot apply migrations at the same time.
- A conversation routed to a different replica may get a fresh sandbox, because sandbox resume state does not cross processes.

Use sticky routing if you want a conversation to keep its sandbox.

## Versions and support

AstralBeam is pre-1.0. Only the latest version is supported, which means the current `main` for self-hosted deployments and the newest `@astralbeam/sdk` release on npm. Security fixes land on `main` and ship in the next release. There are no maintained older release lines and no backports, so upgrade before reporting a problem.

Report a suspected vulnerability privately through [GitHub security advisories](https://github.com/AstralBeamAI/astralbeam/security/advisories/new) rather than a public issue. See [Security](./security.md).
