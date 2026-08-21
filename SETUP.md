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

- Start PostgreSQL and Valkey and wait for both services to become healthy:

  ```bash
  podman compose up --detach --wait
  ```

- From the repository root, stop services with `podman compose down`. Add `--volumes` to permanently delete the local PostgreSQL and Valkey data.

## Configure Google and GitHub OAuth

AstralBeam uses Google and GitHub OAuth through Better Auth. Existing users sign in at `/auth/sign-in`; new users use `/auth/sign-up` and accept the current terms before an OAuth account can be created.

### Create the local environment file

1. Copy the Webapp environment template if `webapp/.env.local` does not already exist:

   ```bash
   cp -n webapp/.env.example webapp/.env.local
   ```

2. Generate a Better Auth secret and set it as `BETTER_AUTH_SECRET` in `webapp/.env.local`:

   ```bash
   openssl rand -base64 32
   ```

3. Keep `BETTER_AUTH_URL=http://localhost:3000`. Leave database and Valkey overrides commented to use the local defaults from `webapp/.env.development`, and never commit `webapp/.env.local`.

### Create the Google OAuth client

Use a development Google Cloud project for local credentials and separate credentials for production.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview), select the development project, and complete the project configuration if prompted.
2. Use an external testing audience and add every Google account that will test local sign-in.
3. Create a **Web application** client named `AstralBeam Local`.
4. Leave authorized JavaScript origins empty and add this exact authorized redirect URI:

   ```text
   http://localhost:3000/api/auth/callback/google
   ```

5. Add the generated credentials to `webapp/.env.local`:

   ```dotenv
   GOOGLE_CLIENT_ID=<google-client-id>
   GOOGLE_CLIENT_SECRET=<google-client-secret>
   ```

Better Auth requests the standard `openid`, `email`, and `profile` scopes. See the [Better Auth Google provider guide](https://better-auth.com/docs/authentication/google) for provider-specific details.

### Create the GitHub OAuth App

Create a separate GitHub OAuth App for each local, staging, or production environment so credentials and redirects remain isolated.

1. Open GitHub **Settings** → **Developer settings** → **OAuth Apps** and choose **New OAuth App**.
2. Use a recognizable name such as `AstralBeam Local` and set the homepage URL to `http://localhost:3000`.
3. Set this exact authorization callback URL:

   ```text
   http://localhost:3000/api/auth/callback/github
   ```

4. Leave wildcard matching and Device Flow disabled, register the application, and add the credentials to `webapp/.env.local`:

   ```dotenv
   GITHUB_CLIENT_ID=<github-client-id>
   GITHUB_CLIENT_SECRET=<github-client-secret>
   ```

See GitHub's [OAuth App guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) for the provider-owned workflow.

### Verify local OAuth

1. Start PostgreSQL and Valkey, apply the checked-in database migrations, then run the Webapp:

   ```bash
   cd webapp
   deno task db migrate
   deno task dev
   ```

2. Open `http://localhost:3000/auth/sign-up`, accept the terms, and authorize a test account. A new user should continue to `/onboarding` to create an organization.
3. Sign out, open `/auth/sign-in`, and use the same provider. The existing user should return to `/dashboard` without another terms prompt.
4. From `/auth/sign-in`, try a provider account that has never registered. AstralBeam should refuse implicit account creation and direct the user to sign-up.

If a provider reports a redirect mismatch, compare the registered URI character-for-character and confirm `BETTER_AUTH_URL=http://localhost:3000`.

### Configure production OAuth

Create separate production credentials, register exact HTTPS callbacks at `https://<production-domain>/api/auth/callback/google` and `https://<production-domain>/api/auth/callback/github`, set `BETTER_AUTH_URL` to that stable origin, and inject secrets through the deployment environment. Complete each provider's production branding, policy, audience, and verification requirements before launch.

## Cloud agent setup

See the setup guides for [Codex](.codex/README.md) and [Cursor Cloud Agents](.cursor/README.md).
