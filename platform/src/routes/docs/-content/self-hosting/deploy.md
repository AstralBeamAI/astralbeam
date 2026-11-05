# Deploy

Install the standalone Linux binary, or use Docker Compose for a local evaluation. Production hosting needs PostgreSQL 18, persistent private storage, email delivery, and an HTTPS reverse proxy.

Choose your installation:

- [Standalone binary on Linux](#binary-on-linux)
- [Docker Compose](#docker-compose)
- [Container with existing services](#existing-services)

## Binary on Linux

The following steps target a Linux host with systemd and `sudo`. Container users can continue at [Complete setup](#6-complete-setup).

### 1. Get a release binary

Download `astralbeam-platform-<target>` from [GitHub releases](https://github.com/AstralBeamAI/astralbeam/releases). Linux and macOS builds support x86_64 and ARM64. Windows supports x86_64. Assets named `astralbeam-<target>` are the [CLI](/docs/cli/getting-started).

Run these commands to download the latest x86_64 asset with the release's `SHA256SUMS`, check the download against it, and install it as `astralbeam-platform`. On an arm64 host, replace `linux-x86_64` with `linux-arm64`:

```sh
curl -fsSLO https://github.com/AstralBeamAI/astralbeam/releases/latest/download/astralbeam-platform-linux-x86_64
curl -fsSLO https://github.com/AstralBeamAI/astralbeam/releases/latest/download/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
sudo install -m 755 astralbeam-platform-linux-x86_64 /usr/local/bin/astralbeam-platform
```

**TIP**: To pin a release, replace `latest/download` with `download/v<version>` in both URLs.

Check for `astralbeam-platform-linux-x86_64: OK` before installing. Checksums verify download integrity, not publisher identity: releases are unsigned. Run `astralbeam-platform version` to confirm the version and target, or `astralbeam-platform --help` for commands.

For a custom build, install the [Bun version named in `.bun-version`](https://bun.sh/docs/installation) and run these commands from the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd sdk build
bun run --cwd platform build
```

**NOTE**: Do not run `scripts/setup.sh` on a deployment host. It installs contributor dependencies, applies migrations, and seeds uninitialized loopback databases with fixed development credentials.

The binary is written to `platform/.output/astralbeam-platform`. At runtime it needs a writable, executable temporary directory to unpack its bundled files.

### 2. Provision the database

PostgreSQL 18 is the minimum. Production deployments should connect through a dedicated account with limited privileges, instead of the `postgres` superuser.

Run these commands to create that role and an empty database it owns:

```sh
createuser --pwprompt astralbeam
createdb --owner=astralbeam astralbeam
```

The application owns its schema from there. The first migration creates the `citext` extension, so the role must be permitted to run `CREATE EXTENSION`.

Connect directly to PostgreSQL or use a [transaction pooler](./operations.md#connection-pooling).

### 3. Set the bootstrap environment

The application needs `DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` at startup. Bootstrap generates the encryption key and authentication secret for a new installation. An existing deployment must keep its original keyring.

The binary loads [environment files](https://bun.com/docs/runtime/environment-variables) from its working directory. Existing environment variables take precedence. Set `NODE_ENV=production` in the service and restart after environment changes. Use `astralbeam-platform --help` for command and environment options.

For a new Linux installation, create an unprivileged service account and its configuration directory:

```sh
sudo useradd --system --user-group --home-dir /etc/astralbeam --shell /usr/sbin/nologin astralbeam
sudo install -d -m 750 -o astralbeam -g astralbeam /etc/astralbeam
sudo -u astralbeam touch /etc/astralbeam/.env.local
sudo chmod 600 /etc/astralbeam/.env.local
sudoedit /etc/astralbeam/.env.local
```

Add your database connection to that file:

```sh title="/etc/astralbeam/.env.local"
DATABASE_URL=postgresql://user:password@host:5432/database
```

Run bootstrap from the same directory the service will use:

```sh
sudo -u astralbeam sh -c 'cd /etc/astralbeam && NODE_ENV=production /usr/local/bin/astralbeam-platform bootstrap'
```

Bootstrap applies migrations and appends missing defaults to `.env.local`. New deployments receive random secrets and local testing defaults. **Before public hosting**, edit the file to set `ALLOW_INSECURE=false` and `SKIP_EMAIL_VERIFICATION=false`, and replace the Turnstile test keys with keys restricted to your hostname. Keep the file private and back up the encryption keyring separately. Use its first entry to sign in at `/configure`.

If you supply your own encryption key, generate a high-entropy value:

```sh
openssl rand -base64 32
```

Each keyring entry must be unique and contain 32 to 1024 characters with no comma. Keep it in your secret manager. Losing it can make encrypted settings unrecoverable. See [key rotation](./security.md#rotating-the-encryption-key) before replacing an existing key.

### 4. Start the server

Run the binary as the service account created in step 3. It loads `.env.local` from its working directory.

Save this unit as `/etc/systemd/system/astralbeam-platform.service`:

```text title="astralbeam-platform.service"
[Unit]
Description=AstralBeam
After=network-online.target

[Service]
User=astralbeam
WorkingDirectory=/etc/astralbeam
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=4510
ExecStart=/usr/local/bin/astralbeam-platform
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Keep `DATABASE_URL` and the keyring in the private `.env.local` file. Environment variables supplied by systemd override that file.

Run these commands to load the unit and start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now astralbeam-platform
```

`systemctl status astralbeam-platform` should now report the service as active, and `curl -i http://127.0.0.1:4510/api/status` should answer `{"status":"ok"}`. The process logs to stdout and stderr, which systemd captures, and exits on SIGTERM, so `systemctl restart` and `systemctl stop` are both clean.

### 5. Put it behind a reverse proxy

Terminate TLS at the proxy, bind the application to loopback, and let nothing else reach the origin. Loopback is always trusted for forwarded host/protocol, so HTTPS `/configure` works without a proxy setting. To use forwarded client IPs, enable Trust Proxy and enter `127.0.0.1,::1` to limit trust to the same-host proxy. For remote proxies, add their socket-peer IPs/CIDRs and retain a `TRUST_PROXY` environment override for operator recovery when database settings are unavailable. See [Reverse proxy trust](./security.md#reverse-proxy-trust).

Add this location block to the server that terminates TLS:

```nginx
location / {
  proxy_pass http://127.0.0.1:4510;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;
}
```

The encryption key grants access to every encrypted value in the database, so `/configure` deserves more protection than the application's own throttle. Restrict who can reach it at the ingress with an IP allowlist, a VPN, or an identity-aware proxy, and rate-limit it there during first setup. See [Security](./security.md).

### 6. Complete setup

Open your deployment's `/configure` page in a browser. Application pages redirect there until setup is complete.

1. Sign in with the first entry of `DATABASE_ENCRYPTION_KEY`. Database credentials and fallback keyring entries are not accepted, and a wrong value reports `Invalid encryption key`.
2. The page shows any pending migrations with their SQL. Expand and review them, then apply them. See [Operations](./operations.md).
3. Review the required settings in [Configuration](./configuration.md), including private storage and both Turnstile keys. Configure and test email delivery, then choose **Save** if needed. The authentication secret is generated on the first save if left unset. Each organization configures connections in [Models](/docs/dashboard/models) and assigns enabled models to its [agents](/docs/dashboard/agents).
4. Under **Owner onboarding**, choose **Invite owner**, then use the email to set the owner's password. If delivery fails, fix [email delivery](./configuration.md#email-delivery) and retry **Invite owner**.
5. Once configuration and owner onboarding are complete, use **Go to app**, which ends the operator session and loads the application. Continue with [Quickstart](/docs/start/quickstart) to embed your first chat.

Sessions last 15 minutes and sign-in is throttled to 5 attempts per minute, so keep the key at hand while you work through the form.

### 7. Verify the deployment

Run each of these against the public origin:

| Check | Expected |
| --- | --- |
| `curl -i https://your-host/api/status` | `200` with `{"status":"ok"}` and `X-Content-Type-Options: nosniff` |
| `curl -sI https://your-host/docs` | `200` with `Cache-Control: public, no-cache` and an `ETag` |
| `curl -s https://your-host/api/openapi.json` | The OpenAPI document, including the `/api/v1/tenants` path |
| `curl -i https://your-host/api/v1/tenants` | `401` once setup is complete, `503` with `Retry-After` while it is not |

`/api/status` counts organization rows and answers `{"status":"ok"}` when that query succeeds. A database failure returns `503` with an `error` field, without the count. There is no separate readiness endpoint, so to check API readiness, call an API route and treat `503` as not ready.

### Upgrade the binary

Read the release notes and [back up the database, files, and keyring](./operations.md#backups-and-restore) before upgrading.

The service account needs a writable, executable temporary directory. Set `TMPDIR` if the system default is restricted. Existing environment and bootstrap settings remain in use after an upgrade.

Before upgrading an existing deployment behind a remote TLS-terminating proxy, set `TRUST_PROXY` to its socket-peer IPs/CIDRs in the service environment. Same-host loopback proxies need no setting for HTTPS `/configure` access. Without an allowlist for a remote proxy, HTTPS `/configure` requests redirect back to HTTPS and mutations are rejected.

1. Run this command to replace the installed binary with the latest release for this host's target:

   ```sh
   sudo astralbeam-platform upgrade
   ```

   Pass a tag to select a release, such as `sudo astralbeam-platform upgrade v0.25.1`. The command downloads the host's asset, verifies `SHA256SUMS`, and replaces the binary after confirmation. Releases before v0.13.4 have no checksum file and are unsupported by this command. Use `--yes` for non-interactive upgrades. Source checkouts must pull and rebuild instead.

2. Run this command with the new binary to apply the release's migrations, as described in [database commands](./operations.md#database-commands):

   ```sh
   sudo -u astralbeam sh -c 'cd /etc/astralbeam && NODE_ENV=production /usr/local/bin/astralbeam-platform migrate'
   ```

   It fails if `DATABASE_URL` is missing from the environment, including [automatically loaded files](#3-set-the-bootstrap-environment). You can skip this step and apply them from `/configure` after the restart instead, where the gate redirects every page until you review and apply the new SQL.

3. Run this command to restart the service, since the running process keeps serving the old binary until then:

   ```sh
   sudo systemctl restart astralbeam-platform
   ```

4. Upgrade and restart every other replica so each one reloads configuration and migration state.

Downgrading is not supported, because a migration has no rollback. `upgrade` refuses an older tag, and without a tag it reports `Already at <version>` when the running binary is newer than the latest release. Reverse a schema change with a forward migration instead.

## Containers

### Docker Compose

This stack creates a new deployment with persistent File System storage and the `0.25.1` image. Existing S3 deployments should keep their current Compose file and storage settings.

Download the current Compose file into an empty directory, then bootstrap a private `.env` file once. The bootstrap refuses to overwrite an existing file:

```sh
curl -fsSLO https://raw.githubusercontent.com/AstralBeamAI/astralbeam/v0.25.1/docker-compose.production.yml

(
  umask 077
  set -C
  printf 'ASTRALBEAM_VERSION=%s\nPOSTGRES_PASSWORD=%s\nDATABASE_ENCRYPTION_KEY=%s\nBETTER_AUTH_SECRET=%s\nALLOW_INSECURE=true\nSKIP_EMAIL_VERIFICATION=true\nTURNSTILE_SITE_KEY=1x00000000000000000000AA\nTURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA\n' \
    "${ASTRALBEAM_VERSION:-0.25.1}" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" \
    > .env
)
```

The `.env` file enables local HTTP, skips password email verification, and supplies Turnstile test keys. Keep these evaluation defaults private. Exported environment variables override the file. Start the stack:

```sh
docker compose -f docker-compose.production.yml up --detach --wait
```

Open http://localhost:4510/configure and follow [Complete setup](#6-complete-setup). Storage is configured at `/var/lib/astralbeam/storage` in the persistent `file-storage` volume. Configure email before inviting the owner.

**NOTE**: If uploads are at the volume root, stop Platform, back up the volume, and move them into `storage/`, preserving ownership.

The stack binds to localhost. Set `PORT` if 4510 is occupied. For public hosting, use [Existing services](#existing-services).

To upgrade, [back up the database, files, and keyring](./operations.md#backups-and-restore), set `ASTRALBEAM_VERSION=<version>` in `.env`, rerun the startup command, and apply pending migrations at `/configure`. Container replacement preserves uploads. `docker compose -f docker-compose.production.yml down` preserves data. **Adding `--volumes` deletes the database and files.**

### Existing services

The image supports Linux AMD64 and ARM64. Provision [PostgreSQL](#2-provision-the-database) and email separately. The command below uses a persistent File System volume and a reverse proxy on the same Linux host.

1. Create a private `./astralbeam.env` file containing `DATABASE_URL`, a high-entropy `DATABASE_ENCRYPTION_KEY`, `APP_BASE_URL=https://your-host`, and `STORAGE_PROVIDER=filesystem`. Use a database hostname reachable from the container. Keep `ALLOW_INSECURE` unset and `SKIP_EMAIL_VERIFICATION=false` for public hosting.
2. Replace `<version>` with a [published image version](https://github.com/orgs/AstralBeamAI/packages/container/package/astralbeam-platform) and start the container:

   ```sh
   docker run -d --name astralbeam-platform --restart unless-stopped --stop-timeout 15 \
     --env-file ./astralbeam.env --network host --env HOST=127.0.0.1 --env PORT=4510 \
     --mount source=astralbeam-files,target=/var/lib/astralbeam \
     'ghcr.io/astralbeamai/astralbeam-platform:<version>'
   ```

3. Configure the [Nginx proxy](#5-put-it-behind-a-reverse-proxy), then open your HTTPS origin's `/configure` page and follow [Complete setup](#6-complete-setup).

[Host networking](https://docs.docker.com/engine/network/drivers/host/) lets the proxy connect over loopback. The image prepares its data directory for UID/GID `10001:10001`. For replicas on multiple hosts, choose [S3-compatible storage](./configuration.md#file-storage) instead of the local volume.

If startup fails, inspect `docker logs astralbeam-platform`. The server needs a writable, executable `/tmp`.

To upgrade, [back up the database, storage, and keyring](./operations.md#backups-and-restore), stop and remove the old container, then repeat steps 2 and 3 with the new image. Recreate containers after environment changes. Older images cannot undo migrations.

To build for the host architecture, run `docker build -f platform/Dockerfile -t astralbeam-platform .` from the repository root.
