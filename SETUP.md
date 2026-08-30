# Setup

## One-time macOS setup

Choose one of the two local workflows below: use the devcontainer or run the codebase directly on macOS.

### Install Podman

- Install Podman Desktop:

  ```bash
  brew install --cask podman-desktop
  ```

- Start Podman Desktop, create a Podman machine, and enable Docker compatibility.

- Do not install the Compose extension from Podman Desktop. Its provider installs a `docker-compose` wrapper that breaks BuildKit functionality.

- Install `podman-compose`:

  ```bash
  brew install podman-compose
  brew uninstall --ignore-dependencies podman # Podman Desktop already provides the Podman CLI
  ```

### Option 1: Use the devcontainer

- Open the repository root in Cursor or VS Code and choose **Reopen in Container**. The devcontainer finishes setup after PostgreSQL and Valkey are healthy.

#### Optional: Match the devcontainer workspace path

To help agent CLIs find the codebase outside the devcontainer, expose the directory containing the repository at `/workspaces` on macOS. For example, a repository cloned at `$HOME/projects/astralbeam` will then be available at `/workspaces/astralbeam`, with the Webapp at `/workspaces/astralbeam/webapp`.

- On modern macOS, `/` is read-only, so use `/etc/synthetic.conf` to create the root-level symlink.
- Check for an existing entry with `sudo grep -n '^workspaces' /etc/synthetic.conf 2>/dev/null`. If nothing is returned, add one:

  ```bash
  export WORKSPACES_PATH=<> # e.g., $HOME/projects
  printf "workspaces\\t$WORKSPACES_PATH\\n" | sudo tee -a /etc/synthetic.conf # The separator must be a literal tab; `printf` supplies it.
  ```

- Reboot your Mac because synthetic entries are created during early startup and cannot be added at runtime. See `man synthetic.conf` for details.
- After rebooting, verify the path:

  ```bash
  readlink /workspaces
  ls -ld /workspaces/astralbeam/webapp
  ```

### Option 2: Run directly on macOS

- From the repository root, run the setup script. It installs the Deno LTS toolchain and the projects' frozen dependencies:

  ```bash
  ./scripts/setup.sh
  ```

- Open a new terminal so the project-managed Deno LTS is on `PATH` before running `deno task` commands.

- The setup script does not install PostgreSQL, Valkey, or Mailpit on macOS. When Docker Compose is available, it starts PostgreSQL, PgBouncer, Valkey, and Mailpit unless `SKIP_DOCKER_COMPOSE=true` is set. PgBouncer is the only database service published to the host, so the default `DATABASE_URL` sends local application, Drizzle, and migration traffic through its transaction pool. Set `PGBOUNCER_HOST_PORT` and update `DATABASE_URL` together only when port 5432 is unavailable; set `POSTGRES_HOST` and `POSTGRES_PORT` to route PgBouncer to a different backend.

- From the repository root, stop services with `docker compose down`. Add `--volumes` to permanently delete the local PostgreSQL, Valkey, and Mailpit data. Use `docker compose exec postgres` only when a documented administrative workflow requires a direct PostgreSQL connection.

## Cloud agent setup

Codex Cloud runs on Ubuntu and uses `INSTALL_EXTRA=codex-db SKIP_DOCKER_COMPOSE=true` so the explicit setup extra installs and starts host PostgreSQL and Valkey without starting Docker Compose.

See the setup guides for [Codex](.codex/README.md) and [Cursor Cloud Agents](.cursor/README.md).

## Authentication and transactional email

AstralBeam uses Better Auth for email/password, Google, and GitHub authentication. Signup requires legal acceptance when a privacy policy or terms URL is configured; email/password signup also requires email verification, and OAuth providers must return a verified email. New OAuth identities must start from signup rather than being created implicitly from sign-in.

Passwords are 12–128 characters and are screened for known compromise outside tests. Verification and reset links expire after one hour, verification signs the user in, password reset revokes other sessions, password changes send a notification, and organization invitations expire after 48 hours. Username, passwordless, OTP, magic-link, change-email, and account-deletion flows are disabled. See Better Auth's [email/password](https://better-auth.com/docs/authentication/email-password), [email](https://better-auth.com/docs/concepts/email), and [organization invitation](https://better-auth.com/docs/plugins/organization#invitations) documentation.

### Configure the environment

`DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` are the required bootstrap variables. `webapp/.env.development` supplies local defaults and is loaded automatically; an existing shell, CI, or deployment value always wins, and `webapp/.env.development.local` holds ignored local overrides. See the [Vite](https://vite.dev/guide/env-and-mode) environment guide.

Set `DATABASE_ENCRYPTION_KEY` to one or more comma-separated raw secrets, with the active encryption secret first and older decryption-only secrets after it. Every trimmed entry must be unique and contain at least 32 characters, and a secret cannot contain a comma. Each entry is hashed with SHA-256 into 32-byte root material; hashing and a length check do not strengthen a weak passphrase, so generate high-entropy values with OpenSSL and keep them in the deployment's secret manager:

```sh
openssl rand -base64 32
```

To rotate an encryption secret, restart with `DATABASE_ENCRYPTION_KEY=new,old`, normally save each value that should move to `new`, then remove `old` only after every dependent value has been saved again. Every write uses the active key. An unknown key ID, malformed JWE, or invalid payload makes that value unreadable; `/configure` permits blind replacement without revealing stored data. Environment changes require a restart, and changing the active key invalidates existing operator sessions.

Sign in to `/configure` with the first active value in `DATABASE_ENCRYPTION_KEY`. On a new database, apply pending migrations there; login throttling starts afterward. Database credentials are never used for configuration access. Sessions expire after 15 minutes and are signed with a key derived from the active encryption key.

The encryption key grants access to every encrypted database value, so require HTTPS and restrict `/configure` with an ingress allowlist, VPN, or identity-aware proxy. Because `/configure` trusts `X-Forwarded-Host` and `X-Forwarded-Proto`, the ingress must overwrite both and prevent direct origin access. Rate-limit at the ingress during setup; afterward, its login limit is shared.

Other runtime settings live in the database `config` table and are managed at `/configure`. Every stored value uses authenticated encryption, while an uppercase environment variable for any registry key takes precedence and makes that field read-only. Sign in to view or edit values; the editor masks them until explicitly revealed. The base URL must be a pathless HTTP(S) origin, production must use HTTPS, and `/configure` generates the required Better Auth secret unless `BETTER_AUTH_SECRET` is set. Restart other server instances after changing database-backed settings.

`EMAIL_PROVIDER` defaults to `smtp`, with `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, and `SMTP_SECURITY=none`. Select Resend API or Amazon SES API only when using those native integrations. Never reuse local Better Auth secrets, OAuth clients, or email credentials in production.

OAuth callbacks are always derived from the configured application base URL:

```text
<app-base-url>/api/auth/callback/google
<app-base-url>/api/auth/callback/github
```

Separate local and production OAuth applications keep localhost callbacks, branding, access, logs, revocation, and credential rotation isolated.

### Configure Cloudflare Turnstile

Follow Cloudflare's [Turnstile setup guide](https://developers.cloudflare.com/turnstile/get-started/) to create a widget and obtain its public site key and private secret key.

1. Create separate Turnstile widgets for each environment so their hostnames, analytics, and key rotation remain isolated.
2. Restrict each non-test widget to the exact hostnames that serve that environment; production widgets should not allow localhost domains.
3. Store both matching keys in that deployment's `/configure` page. Setup cannot complete without them. The site key is sent to browsers, while the secret key remains server-only and is used by Better Auth to validate tokens with Cloudflare.
4. For local and automated browser testing, use Cloudflare's [documented test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) instead of production keys.

### Configure Google OAuth

Follow Google's current [client](https://support.google.com/cloud/answer/15549257), [branding](https://support.google.com/cloud/answer/15549049), [audience](https://support.google.com/cloud/answer/15549945), and [OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies) instructions. Request only the standard `openid`, `email`, and `profile` scopes documented for [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

1. Create separate Google Cloud projects and **Web application** clients named `AstralBeam Local` and `AstralBeam Production`.
2. Configure Branding with AstralBeam's public homepage, privacy policy, terms, monitored support email, and developer contacts; add the owned domain under **Authorized domains**.
3. For local use, select an External/Testing audience unless access is intentionally organization-restricted, add test users when Google or Workspace policy requires them, add `http://localhost:3000` as the exact JavaScript origin, and add `http://localhost:3000/api/auth/callback/google` as the exact redirect URI.
4. For production, [verify the production domain](https://support.google.com/webmasters/answer/9008080), keep the homepage and legal links public and consistent, select the intended audience and publishing status, add the exact HTTPS application origin, and add `<production-app-origin>/api/auth/callback/google` as the exact redirect URI.
5. Store each environment's client credentials at that deployment's `/configure` page; confirm the production project has no localhost origin, callback, or development credential.
6. Smoke-test signup, configured legal acceptance, existing-account sign-in, account linking, and logout in both environments; confirm Google returns a verified email and requests no scope beyond OpenID/profile/email.

### Configure GitHub OAuth

Create browser-flow OAuth Apps—not GitHub Apps or Device Flow applications—using GitHub's [OAuth App creation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), and [scope](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) guides. Better Auth requests `read:user` and `user:email`; the latter is required to retrieve private verified addresses.

1. Open **Settings → Developer settings → OAuth Apps → New OAuth App**, or create the app under the owning AstralBeam organization.
2. Create `AstralBeam Local` with homepage `http://localhost:3000` and callback `http://localhost:3000/api/auth/callback/github`.
3. Create a separate `AstralBeam Production` app with the public HTTPS application homepage and callback `<production-app-origin>/api/auth/callback/github`.
4. Leave **Enable Device Flow** and callback wildcard matching disabled for both apps.
5. Generate separate secrets and store each environment's credentials at that deployment's `/configure` page, keeping localhost values out of the production app.
6. Smoke-test signup, sign-in, account linking, and logout with public- and private-email profiles in both environments; confirm the authorization screen requests only `read:user` and `user:email`.

If GitHub returns `email_not_found`, ensure the account has a verified email, reauthorize with `user:email`, and confirm the application authorization was not reduced.

### Capture email with Mailpit

The default SMTP settings connect to `127.0.0.1:1025` without TLS or authentication. The Compose Mailpit service captures every message without delivering it externally and exposes its inbox at [http://localhost:8025](http://localhost:8025). The devcontainer sets `SMTP_HOST=mailpit` so the same SMTP provider reaches the Compose service.

When `EMAIL_FROM_ADDRESS` is unset, Mailpit derives `no-reply@<hostname>` from `APP_BASE_URL`. The Mailpit ports are bound only to loopback for host development and the captured inbox persists in the `mailpit-data` Compose volume.

### Configure SMTP

Use the same `smtp` provider for Mailpit, MailHog, smtp4dev, Postfix, internal relays, Gmail, and hosted transactional SMTP. Override `SMTP_HOST` and `SMTP_PORT` as needed. Set `SMTP_SECURITY=none` for a trusted plaintext endpoint, `auto` to use STARTTLS when advertised while allowing an unencrypted fallback, `starttls` to require STARTTLS (commonly port 587), or `tls` for TLS from connection start (commonly port 465). `SMTP_USERNAME` and `SMTP_PASSWORD` are optional, but must be supplied together; omitting both sends without authentication. `EMAIL_FROM_ADDRESS` remains optional and otherwise derives `no-reply@<hostname>` from `APP_BASE_URL`. The Email Delivery section on `/configure` can test unsaved SMTP, Resend, or SES settings without sending an email. The SES test uses `GetAccount`, so its credentials also need `ses:GetAccount` permission.

### Configure Resend

Use Resend's [API-key](https://resend.com/docs/dashboard/api-keys/introduction), [domain](https://resend.com/docs/dashboard/domains/introduction), and [sender-address](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend) guides.

1. Create separate local and production API keys with **Sending access**, restrict each to its sending domain when possible, and store it only in the matching environment.
2. For a single-developer local test, `onboarding@resend.dev` may send only to the Resend account owner's address; see the [shared-domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
3. For teammates or production, verify an owned environment-specific sending subdomain with the exact SPF and DKIM records Resend supplies, then use a From address on that domain.
4. Set `EMAIL_PROVIDER=resend`, `EMAIL_FROM_ADDRESS`, and `RESEND_API_KEY`, then smoke-test verification, reset, password-change notification, and invitation links with controlled inboxes. Inspect link origins, expiry copy, authentication, delivery logs, and spam placement before production rollout.

### Configure Amazon SES

SES identities, sandbox status, and limits are regional. Follow AWS's [identity](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html), [Regions](https://docs.aws.amazon.com/ses/latest/dg/regions.html), [IAM](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html), [production-access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), and [credential-chain](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html) guides.

1. In separate development and production AWS accounts or environments, choose the SES Region and verify an environment-specific email or domain identity with Easy DKIM.
2. During local sandbox use, verify every real sender and recipient; the [mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html) can test delivery outcomes but cannot complete a token-bearing link flow.
3. Grant only `ses:SendEmail`, preferably limited to the verified identity ARN. Use a local SSO/profile and a deployment role rather than static keys whenever possible.
4. For production, verify the domain in the selected Region, configure DKIM and the planned MAIL FROM/DMARC records, request production access for transactional mail, and confirm the account is out of the sandbox in that Region.
5. Set `EMAIL_PROVIDER=ses`, the verified `EMAIL_FROM_ADDRESS`, and matching `AWS_REGION`; set `AWS_PROFILE` locally when needed and let production use role credentials.
6. Smoke-test verification, reset, password-change notification, and invitation links with controlled inboxes, then monitor bounces, complaints, suppression, and sending health.

Choose one email provider per environment and do not configure credentials or permissions for unused providers.

### Run locally

After configuration, run from `webapp`:

```sh
deno task dev
```

Open `http://localhost:3000/auth/sign-up`. When legal URLs are configured, confirm signup controls remain disabled until acceptance. Confirm email/password signup requires verification, new social identities cannot be created from sign-in, and invitation acceptance requires the matching verified email.

### Test email safety

Automated tests never send live email. Test mode rejects delivery before loading any provider, so tests must inject or mock provider boundaries and use only deterministic non-secret OAuth placeholders. Never add live SMTP, Resend, AWS, OAuth, or recipient credentials to fixtures, snapshots, CI variables, logs, screenshots, or acceptance output.

Provider-console smoke tests are manual and use controlled accounts. Resend's [test addresses](https://resend.com/docs/dashboard/emails/send-test-emails) and the SES mailbox simulator cover non-clickable delivery outcomes; token-bearing verification, reset, and invitation flows require a controlled inbox that can open the link.

### Troubleshooting

- **Configuration cannot be loaded:** confirm `DATABASE_URL` resolves and every unique `DATABASE_ENCRYPTION_KEY` entry contains at least 32 characters.
- **Cannot sign in to `/configure`:** enter the first active value from `DATABASE_ENCRYPTION_KEY`; database credentials and fallback keys are not accepted.
- **Stored value is unreadable:** restore the key that encrypted it or enter a replacement at `/configure`; malformed JWE and unknown key IDs never fall back to unverified data.
- **Missing configuration:** check `/configure` for unset or invalid required values; each server process gates the app using its cached configuration snapshot.
- **Origins do not match:** set the application base URL at `/configure` to the exact origin with no path, query, or fragment.
- **Google redirect, audience, or branding error:** compare the exact origin and callback against the correct Web client, check test-user/audience state, verify the production domain, and keep scopes to `openid`, `email`, and `profile`; see Better Auth's [Google guide](https://better-auth.com/docs/authentication/google).
- **GitHub callback or email error:** use the exact callback in the correct environment's OAuth App, keep wildcard matching off, and reauthorize a verified address with `user:email`; see Better Auth's [GitHub guide](https://better-auth.com/docs/authentication/github).
- **OAuth state expired:** restart from AstralBeam instead of reusing a provider callback, keep the same host and port throughout the flow, and allow application cookies.
- **Email link opens the wrong environment:** correct both origins and that environment's provider credentials, then discard the old message and request a new link.
- **Resend returns 403:** send from `onboarding@resend.dev` only to the Resend account owner or verify an owned sending domain.
- **SES returns `MessageRejected`:** check identity verification, sandbox status, `AWS_REGION`, recipient verification, and `ses:SendEmail` permission.
- **Tests reject email delivery:** keep the safety boundary and mock the provider rather than adding real credentials.
- **Invitation cannot be accepted:** use an unexpired link while signed in with the exact invited, verified email; renewal extends and resends the pending invitation without changing its recipient.
