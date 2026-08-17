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

- Open the repository in Cursor or VS Code and choose **Reopen in Container**. The devcontainer starts after PostgreSQL and Valkey are healthy.

#### Optional: Match the devcontainer workspace path

To help agent CLIs find the codebase outside the devcontainer, create the same `/workspaces` path on macOS:

- On modern macOS, `/` is read-only, so use `/etc/synthetic.conf` to create the root-level symlink.
- Check for an existing entry with `sudo grep -n '^workspaces' /etc/synthetic.conf 2>/dev/null`. If nothing is returned, add one:

  ```bash
  export PROJECT_PATH=<> # e.g., $HOME/projects/astralbeam
  printf "workspaces\\t$PROJECT_PATH\\n" | sudo tee -a /etc/synthetic.conf # The separator must be a literal tab; `printf` supplies it.
  ```

- Reboot your Mac because synthetic entries are created during early startup and cannot be added at runtime. See `man synthetic.conf` for details.
- After rebooting, verify the path:

  ```bash
  readlink /workspaces
  ls -ld /workspaces/astralbeam
  ```

### Option 2: Run directly on macOS

- From the repository root, run the shared setup script, then start a new login shell:

  ```bash
  ./scripts/setup.sh
  ```

- Start PostgreSQL and Valkey and wait for both services to become healthy:

  ```bash
  podman compose up --detach --wait
  ```

- Stop services with `podman compose down`. Add `--volumes` to permanently delete the local PostgreSQL and Valkey data.

## Configure Google and GitHub OAuth

AstralBeam uses Google and GitHub OAuth through Better Auth. Existing users sign in at `/auth/sign-in`, while new users must use the separate `/auth/sign-up` page and accept the current terms before an OAuth account can be created.

### Create the local environment file

1. From the repository root, copy the environment template if `.env.local` does not already exist:

   ```bash
   cp -n .env.example .env.local
   ```

2. Generate a Better Auth secret:

   ```bash
   vp run auth:secret
   ```

3. Put the generated value in `BETTER_AUTH_SECRET` in `.env.local`. Keep `BETTER_AUTH_URL=http://localhost:3000`, leave the database and Valkey overrides commented to use the containerized defaults from `.env.development`, and never commit `.env.local`.

### Create the Google OAuth client

Use a development Google Cloud project for these local credentials. Create separate credentials in the production project when deploying AstralBeam.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview), select the development project, and click **Get started** if prompted.
2. Complete the project configuration with these values:
   - **App name:** `AstralBeam Local`
   - **User support email:** an email monitored by the development team
   - **Audience:** **External**
   - **Contact information:** an email monitored by the development team
3. Leave the app in **Testing**. Open **Audience** → **Add users** and add every Google account that will test local sign-in.
4. Open **Clients** → **Create client**, choose **Web application**, and name it `AstralBeam Local`.
5. Leave **Authorized JavaScript origins** empty. Under **Authorized redirect URIs**, add this exact URI:

   ```text
   http://localhost:3000/api/auth/callback/google
   ```

6. Click **Create**, then copy the client ID and client secret into `.env.local`:

   ```dotenv
   GOOGLE_CLIENT_ID=<google-client-id>
   GOOGLE_CLIENT_SECRET=<google-client-secret>
   ```

No changes are required under **Data Access** for basic Google sign-in. Better Auth requests only `openid`, `email`, and `profile`. See the [Better Auth Google provider guide](https://better-auth.com/docs/authentication/google) and [Google OAuth client documentation](https://support.google.com/cloud/answer/15549257).

### Create the GitHub OAuth App

Create a separate GitHub OAuth App for each local, staging, or production environment so their credentials and redirect URIs remain isolated. These steps create the local development app using [GitHub's OAuth App settings](https://github.com/settings/developers).

1. In GitHub, open **Settings** → **Developer settings** → **OAuth Apps** and choose **New OAuth App**. An organization administrator can instead create an organization-owned OAuth App from that organization's settings.
2. Set **Application name** to a recognizable name such as `AstralBeam Local`.
3. Set **Homepage URL** to:

   ```text
   http://localhost:3000
   ```

4. Optionally add an application description that clearly identifies this as the local development client.
5. Set **Authorization callback URL** to this exact URI:

   ```text
   http://localhost:3000/api/auth/callback/github
   ```

6. Leave **Allow wildcard matching** and **Enable Device Flow** disabled, keep **Expire user access tokens** enabled, then choose **Register application**.
7. Copy the **Client ID**, choose **Generate a new client secret**, and copy the secret immediately.
8. Add the credentials to `.env.local`:

   ```dotenv
   GITHUB_CLIENT_ID=<github-client-id>
   GITHUB_CLIENT_SECRET=<github-client-secret>
   ```

See GitHub's [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) guide for the provider-owned workflow.

### Verify local OAuth

1. Ensure PostgreSQL and Valkey are running, then start the application from the repository root:

   ```bash
   vp run webapp
   ```

2. Open `http://localhost:3000/auth/sign-up`, accept the terms, and complete Google or GitHub authorization with a test account. A new user should return to `/onboarding` to create their first organization.
3. Sign out, open `http://localhost:3000/auth/sign-in`, and use the same provider. The existing user should return to `/dashboard` without being asked to accept the terms again.
4. In a clean database, try `/auth/sign-in` with a different provider account that has never registered. AstralBeam should refuse implicit account creation and direct that user to the separate sign-up flow.

If a provider reports a redirect mismatch, compare the URI character-for-character with the callback above and confirm `BETTER_AUTH_URL=http://localhost:3000`. If Better Auth reports that sign-up is disabled from the sign-in page, that is the intended behavior for an account that has not completed the terms-gated sign-up flow.

### Configure production OAuth

1. Create separate production Google and GitHub credentials; do not reuse local client secrets.
2. Register exact HTTPS callbacks using the production origin: `https://<production-domain>/api/auth/callback/google` and `https://<production-domain>/api/auth/callback/github`.
3. Set `BETTER_AUTH_URL` to the same stable HTTPS origin and inject all secrets through the deployment environment rather than an environment file committed to the repository.
4. For Google, configure the production branding, homepage, privacy policy, terms, authorized domain, audience, and any required verification before publishing. Google documents these requirements in its [brand verification guide](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).

## Cloud agent setup

See the setup guides for [Codex](.codex/README.md) and [Cursor Cloud Agents](.cursor/README.md).
