# Setup

## Host prerequisites

Install Git and, if Bun is missing, curl and unzip. Setup installs the pinned Bun version. Install and start PostgreSQL 18 on your host, or use the [native Linux setup](#development-without-docker). Run application code natively. File System storage needs no additional service or credentials.

Set `DATABASE_URL` in ignored `platform/.env.local` to a local database owned by your application role. That role also needs `CREATEDB` for worktree setup to create separate databases.

## Local development

### 1. Initialize the workspace

From the repository root:

```sh
./scripts/setup.sh
```

Setup installs frozen dependencies, applies migrations, seeds an uninitialized database, and builds the SDK. Worktree setup copies missing environment files from the primary checkout before loading configuration. Existing environment values take precedence over files. Existing services, credentials, and data are preserved. Open a new terminal afterward to pick up Bun on `PATH`.

| `SERVICES` | Behavior |
| --- | --- |
| Unset | Use existing services without installing or starting them. Run `./scripts/setup.sh`. |
| `docker` | Start Compose and wait for healthy services without recreating containers. |
| `native` | [Install and start services](#development-without-docker) on Ubuntu 24.04 or Debian 13. Requires root or sudo. |

Optional Linux helpers use `INSTALL_EXTRA`, such as `linux-tools profiled`. `linux-tools` installs development tools and the `psql` client, without database servers. System-package installation requires root or sudo.

The [seed](platform/src/db/README.md#seed-sample-data) prints local credentials and creates missing Todos example `.env` files. To seed a Development OpenAI connection, put `OPENAI_API_KEY` in ignored `platform/.env.local` before setup. Existing providers and model choices are preserved. For an initialized database, rerun the seed explicitly. Manage connections under **Models**, enable models, and assign them to agents.

### Local services

New databases use File System storage unless another provider is explicitly configured. Seeding assigns a separate directory per database under the platform's [default storage directory](platform/src/routes/docs/-content/self-hosting/configuration.md#file-storage). Existing storage settings are preserved. View or change the destination under **File storage** at `/configure`.

To use containers for supporting services, install and start Docker, then run `SERVICES=docker ./scripts/setup.sh`. Compose provides PostgreSQL through PgBouncer and Mailpit for email testing. PgBouncer is the only host-published database endpoint. If 5432 is occupied, change `PGBOUNCER_HOST_PORT` and `DATABASE_URL` together. `POSTGRES_HOST` and `POSTGRES_PORT` select its backend. Native and Compose versions of the same service need different host ports to run together.

Service startup uses `SERVICES` from the shell environment. Devcontainers mount `file-storage` at `/var/lib/astralbeam/storage` for persistent File System storage.

Apply intentional Compose configuration changes with `docker compose up --detach --wait`. Stop services with `docker compose down`. Setup never resets an existing database. Use the explicit [database commands](platform/src/db/README.md#database-commands) to reset or seed only the current worktree database, never shared volumes. Use `docker compose exec postgres` only for direct administration.

Before changing storage destinations, follow the [storage migration procedure](platform/src/routes/docs/-content/self-hosting/configuration.md#file-storage). Retain old storage until needed files have been copied and verified.

### 2. Run the applications

From the repository root, start the applications and SDK watcher:

```sh
bun run dev
```

| Application | Local URL | Guide |
| --- | --- | --- |
| Platform | `http://localhost:4500` | [Authentication and email](#authentication-and-transactional-email) |
| Website | `http://localhost:4600` | [Website](website/README.md) |
| Todos | `http://localhost:4700` | [Todos](examples/todos/README.md) |
| Linearity | `http://localhost:4900` | [Set Basic Auth and Astro credentials first](examples/linearity-react/README.md) |

The [Rails example](examples/todos-rails/README.md) runs separately with `bin/setup` from its directory on port 4800. Reload examples after SDK changes so they use the rebuilt output.

For one project, use `bun run --cwd <project> <task>` or a root alias such as `bun run dev:platform`. `bun run` lists tasks. `bun run build` builds all Bun projects with the SDK first. Follow [contribution validation](CONTRIBUTING.md#validate-your-change) before opening a PR.

#### Port allocation

Application port conventions use `xx00` for development, `xx10` for production, and `xx20` for preview where provided. Platform production defaults to `4510` and website preview to `4620`. Existing deployments keep their explicit ports. See [deployment](platform/src/routes/docs/-content/self-hosting/deploy.md) for production commands.

Override Platform with `PORT` or Vite servers with `--port`. Keep the application base URL, consumer API URLs, and proxy targets aligned. Development and preview reject occupied ports. The embedded Effect Cluster runner initializes its PostgreSQL storage automatically, uses an OS-assigned loopback port, and needs no separate worker command. See the [cluster](platform/src/lib/cluster/README.md) and [workflow](platform/src/lib/workflows/README.md) guides for runtime details.

## Development without Docker

On Ubuntu 24.04 or Debian 13:

```sh
SERVICES=native ./scripts/setup.sh
```

This installs and starts PostgreSQL 18 and Valkey 9. Rerun it after restarting the machine. Existing binaries, credentials, and healthy services are preserved. Upgrades and repairs are manual. File System storage needs no separate service. Configure email separately below.

## Cloud agent setup

See the [Codex](.codex/README.md) and [Cursor Cloud Agents](.cursor/README.md) guides. Codex Cloud uses the native command above for setup and maintenance.

## Authentication and transactional email

### Configure the environment

`DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` are the required bootstrap variables. `platform/.env.development` supplies local defaults and is loaded automatically. Use ignored `platform/.env.development.local` for overrides. Shell, CI, and deployment values take precedence. See [Vite environment loading](https://vite.dev/guide/env-and-mode).

#### Database encryption key

`DATABASE_ENCRYPTION_KEY` protects stored runtime settings, model and sandbox credentials, and MCP authorization data. It does not encrypt the whole database. The active key also grants operator access to `/configure`, so keep it private and back it up securely with the database. Never reuse the development default in production.

Set it to one or more comma-separated raw secrets. The first entry encrypts new writes and is the operator sign-in credential. Later entries only decrypt older values. Each trimmed entry must be unique, contain 32–1024 characters, and contain no comma. Each entry is hashed with SHA-256 into 32-byte root material. Hashing and a length check do not strengthen a weak passphrase, so generate high-entropy values and keep them in your secret manager:

```sh
openssl rand -base64 32
```

To rotate a key:

1. Restart every server instance with `DATABASE_ENCRYPTION_KEY=new,old`, placing the new secret first. Changing the active key invalidates operator sessions. Sign in again with the new value.
2. Follow the [key-rotation procedure](platform/src/routes/docs/-content/self-hosting/security.md#rotating-the-encryption-key) to rewrite or replace all dependent settings, provider and sandbox credentials, and MCP authorization data. Saving unchanged sandbox credentials does not rewrite them. There is no automatic whole-database re-encryption command.
3. Remove the old entry only after every dependent encrypted value has been rewritten or replaced, then restart every instance. Removing it too early makes those values unreadable. An empty fallback warning list on `/configure` does not prove rotation is complete.

Sign in to `/configure` with the first raw secret, never database credentials or a fallback entry. Operator sessions last 15 minutes. Apply pending migrations there on a new database. Missing keys or damaged ciphertext make stored values unreadable, but `/configure` permits replacement without revealing the old value.

Protect `/configure` with HTTPS and restricted ingress in production. Its credential can decrypt the deployment's stored secrets. See the [security guide](platform/src/routes/docs/-content/self-hosting/security.md) for proxy and access requirements.

#### Runtime settings

Manage encrypted runtime settings through `/configure`. The editor masks values until explicitly revealed. Environment overrides make their fields read-only. The application base URL must be a pathless HTTP(S) origin and use HTTPS in production. `/configure` generates the required Better Auth secret unless `BETTER_AUTH_SECRET` is set. Restart other server instances after changing database-backed settings, and restart the process after environment changes. See the [configuration guide](platform/src/routes/docs/-content/self-hosting/configuration.md) for the complete settings.

### Configure Cloudflare Turnstile

Follow Cloudflare's [Turnstile setup guide](https://developers.cloudflare.com/turnstile/get-started/) to create a widget and obtain its public site key and private secret key.

1. Create separate Turnstile widgets for each environment so their hostnames, analytics, and key rotation remain isolated.
2. Restrict each non-test widget to the exact hostnames that serve that environment. Production widgets should not allow localhost domains.
3. Store both matching keys in that deployment's `/configure` page. Setup cannot complete without them. The site key is sent to browsers, while the secret key remains server-only and is used by Better Auth to validate tokens with Cloudflare.
4. For local and automated browser testing, use Cloudflare's [documented test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) instead of production keys.

### Configure Google OAuth

Follow Google's current [client](https://support.google.com/cloud/answer/15549257), [branding](https://support.google.com/cloud/answer/15549049), [audience](https://support.google.com/cloud/answer/15549945), and [OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies) instructions. Request only the standard `openid`, `email`, and `profile` scopes documented for [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

1. Create separate Google Cloud projects and **Web application** clients named `AstralBeam Local` and `AstralBeam Production`.
2. Configure Branding with AstralBeam's public homepage, privacy policy, terms, monitored support email, and developer contacts. Add the owned domain under **Authorized domains**.
3. For local use, select an External/Testing audience unless access is intentionally organization-restricted, add test users when Google or Workspace policy requires them, add `http://localhost:4500` as the exact JavaScript origin, and add `http://localhost:4500/api/auth/callback/google` as the exact redirect URI.
4. For production, [verify the production domain](https://support.google.com/webmasters/answer/9008080), keep the homepage and legal links public and consistent, select the intended audience and publishing status, add the exact HTTPS application origin, and add `<production-app-origin>/api/auth/callback/google` as the exact redirect URI.
5. Store each environment's client credentials at that deployment's `/configure` page. Confirm the production project has no localhost origin, callback, or development credential.
6. Smoke-test signup, configured legal acceptance, existing-account sign-in, account linking, and logout in both environments. Confirm Google returns a verified email and requests no scope beyond OpenID/profile/email.

### Configure GitHub OAuth

Create browser-flow OAuth Apps using GitHub's [OAuth App creation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), and [scope](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) guides. Better Auth requests `read:user` and `user:email`. The latter is required to retrieve private verified addresses.

1. Open **Settings → Developer settings → OAuth Apps → New OAuth App**, or create the app under the owning AstralBeam organization.
2. Create `AstralBeam Local` with homepage `http://localhost:4500` and callback `http://localhost:4500/api/auth/callback/github`.
3. Create a separate `AstralBeam Production` app with the public HTTPS application homepage and callback `<production-app-origin>/api/auth/callback/github`.
4. Leave **Enable Device Flow** and callback wildcard matching disabled for both apps.
5. Generate separate secrets and store each environment's credentials at that deployment's `/configure` page, keeping localhost values out of the production app.
6. Smoke-test signup, sign-in, account linking, and logout with public- and private-email profiles in both environments. Confirm the authorization screen requests only `read:user` and `user:email`.

If GitHub returns `email_not_found`, ensure the account has a verified email, reauthorize with `user:email`, and confirm the application authorization was not reduced.

### Capture email with Mailpit

The default SMTP settings connect to `127.0.0.1:1025` without TLS or authentication. The Compose Mailpit service captures every message without delivering it externally and exposes its inbox at [http://localhost:8025](http://localhost:8025).

When `EMAIL_FROM_ADDRESS` is unset, AstralBeam derives `no-reply@<hostname>` from `APP_BASE_URL`. The Mailpit ports are bound only to loopback for host development and the captured inbox persists in the `mailpit-data` Compose volume.

### Configure SMTP

Use the same `smtp` provider for Mailpit, MailHog, smtp4dev, Postfix, internal relays, Gmail, and hosted transactional SMTP. Override `SMTP_HOST` and `SMTP_PORT` as needed. Set `SMTP_SECURITY=none` for a trusted plaintext endpoint, `auto` to use STARTTLS when advertised while allowing an unencrypted fallback, `starttls` to require STARTTLS (commonly port 587), or `tls` for TLS from connection start (commonly port 465). `SMTP_USERNAME` and `SMTP_PASSWORD` are optional, but must be supplied together. Omitting both sends without authentication. `EMAIL_FROM_ADDRESS` remains optional and otherwise derives `no-reply@<hostname>` from `APP_BASE_URL`. The Email Delivery section on `/configure` can test unsaved SMTP, Resend, or SES settings without sending an email. The SES test uses `GetAccount`, so its credentials also need `ses:GetAccount` permission.

### Configure Resend

Use Resend's [API-key](https://resend.com/docs/dashboard/api-keys/introduction), [domain](https://resend.com/docs/dashboard/domains/introduction), and [sender-address](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend) guides.

1. Create separate local and production API keys with **Sending access**, restrict each to its sending domain when possible, and store it only in the matching environment.
2. For a single-developer local test, `onboarding@resend.dev` may send only to the Resend account owner's address. See the [shared-domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
3. For teammates or production, verify an owned environment-specific sending subdomain with the exact SPF and DKIM records Resend supplies, then use a From address on that domain.
4. Set `EMAIL_PROVIDER=resend`, `EMAIL_FROM_ADDRESS`, and `RESEND_API_KEY`, then smoke-test verification, reset, password-change notification, and invitation links with controlled inboxes. Inspect link origins, expiry copy, authentication, delivery logs, and spam placement before production rollout.

### Configure Amazon SES

SES identities, sandbox status, and limits are regional. Follow AWS's [identity](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html), [Regions](https://docs.aws.amazon.com/ses/latest/dg/regions.html), [IAM](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html), [production-access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), and [credential-chain](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html) guides.

1. In separate development and production AWS accounts or environments, choose the SES Region and verify an environment-specific email or domain identity with Easy DKIM.
2. During local sandbox use, verify every real sender and recipient. The [mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html) can test delivery outcomes but cannot complete a token-bearing link flow.
3. Grant only `ses:SendEmail`, preferably limited to the verified identity ARN. Use a local SSO/profile and a deployment role rather than static keys whenever possible.
4. For production, verify the domain in the selected Region, configure DKIM and the planned MAIL FROM/DMARC records, request production access for transactional mail, and confirm the account is out of the sandbox in that Region.
5. Set `EMAIL_PROVIDER=ses`, the verified `EMAIL_FROM_ADDRESS`, and matching `AWS_REGION`. Set `AWS_PROFILE` locally when needed and let production use role credentials.
6. Smoke-test verification, reset, password-change notification, and invitation links with controlled inboxes, then monitor bounces, complaints, suppression, and sending health.

Choose one email provider per environment and do not configure credentials or permissions for unused providers.

### Run locally

Open `http://localhost:4500/auth/sign-up`. Verify required legal acceptance and email verification. New OAuth identities start from signup, not sign-in. Invitations require the matching verified email. Use Mailpit to inspect verification, reset, and invitation links.

### Test email safety

Automated tests never send live email. Test mode rejects delivery before loading any provider, so tests must inject or mock provider boundaries and use only deterministic non-secret OAuth placeholders. Never add live SMTP, Resend, AWS, OAuth, or recipient credentials to fixtures, snapshots, CI variables, logs, screenshots, or acceptance output.

Provider-console smoke tests are manual and use controlled accounts. Resend's [test addresses](https://resend.com/docs/dashboard/emails/send-test-emails) and the SES mailbox simulator cover non-clickable delivery outcomes. Token-bearing verification, reset, and invitation flows require a controlled inbox that can open the link.

### Troubleshooting

- **Configuration cannot be loaded:** confirm `DATABASE_URL` resolves and every unique `DATABASE_ENCRYPTION_KEY` entry contains at least 32 characters.
- **Cannot sign in to `/configure`:** enter the first active value from `DATABASE_ENCRYPTION_KEY`. Database credentials and fallback keys are not accepted.
- **Stored value is unreadable:** restore the key that encrypted it or enter a replacement at `/configure`. Malformed JWE and unknown key IDs never fall back to unverified data.
- **Missing configuration:** check `/configure` for unset or invalid required values. Each server process gates the app using its cached configuration snapshot.
- **Origins do not match:** set the application base URL at `/configure` to the exact origin with no path, query, or fragment.
- **Google redirect, audience, or branding error:** compare the exact origin and callback against the correct Web client, check test-user/audience state, verify the production domain, and keep scopes to `openid`, `email`, and `profile`. See Better Auth's [Google guide](https://better-auth.com/docs/authentication/google).
- **GitHub callback or email error:** use the exact callback in the correct environment's OAuth App, keep wildcard matching off, and reauthorize a verified address with `user:email`. See Better Auth's [GitHub guide](https://better-auth.com/docs/authentication/github).
- **OAuth state expired:** restart from AstralBeam instead of reusing a provider callback, keep the same host and port throughout the flow, and allow application cookies.
- **Email link opens the wrong environment:** correct both origins and that environment's provider credentials, then discard the old message and request a new link.
- **Resend returns 403:** send from `onboarding@resend.dev` only to the Resend account owner or verify an owned sending domain.
- **SES returns `MessageRejected`:** check identity verification, sandbox status, `AWS_REGION`, recipient verification, and `ses:SendEmail` permission.
- **Tests reject email delivery:** keep the safety boundary and mock the provider rather than adding real credentials.
- **Invitation cannot be accepted:** use an unexpired link while signed in with the exact invited, verified email. Renewal extends and resends the pending invitation without changing its recipient.
