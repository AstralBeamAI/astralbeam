# Deploy

Choose Docker Compose for a local evaluation, a container with existing services, or a standalone Linux binary. Each deployment needs PostgreSQL, private storage, and email delivery.

## Containers

### Docker Compose

Use Docker Compose 2.30 or later. Download the Compose file into an empty directory, then bootstrap a private `.env` file once. The bootstrap refuses to overwrite an existing file:

```sh
curl -fsSLO https://raw.githubusercontent.com/AstralBeamAI/astralbeam/v0.23.7/docker-compose.production.yml

(
  umask 077
  set -C
  printf 'POSTGRES_PASSWORD=%s\nDATABASE_ENCRYPTION_KEY=%s\nRUSTFS_ACCESS_KEY=astralbeam\nRUSTFS_SECRET_KEY=%s\n' \
    "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" \
    > .env
)
```

Compose rejects missing or empty PostgreSQL and RustFS credentials before starting containers. Platform validates its encryption key at startup. Exported environment variables override `.env` values. Start the stack with an explicit HTTP opt-in for this local setup:

```sh
ALLOW_INSECURE=true docker compose -f docker-compose.production.yml up --detach --wait
```

The private `astralbeam` bucket is created automatically. Open http://localhost:3000/configure and follow [Complete setup](#6-complete-setup). Storage is already configured. Configure your email provider before inviting the owner.

The stack binds to localhost and requires HTTPS unless `ALLOW_INSECURE=true` is explicitly set. The RustFS admin console is available only inside the container network. For public hosting with external storage and email, use [Existing services](#existing-services). [Back up](./operations.md#backups-and-restore) before upgrading, keeping the environment file separately from database backups. Set `ASTRALBEAM_VERSION=<version>` in `.env`, rerun the startup command, and apply pending migrations at `/configure`. Using the same flags, `down` preserves data, while `down --volumes` deletes it.

### Existing services

The Linux AMD64 and ARM64 image contains Platform only. Provision [PostgreSQL 18](#2-provision-the-database), private S3-compatible storage, and email delivery separately.

1. Save `DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` in a private environment file, such as `./astralbeam.env`, readable only by the operator. See [bootstrap settings](#3-set-the-bootstrap-environment) for their values. Use a database hostname reachable from the container. For local HTTP, also set `APP_BASE_URL=http://localhost:3000` and `ALLOW_INSECURE=true`.
2. For local HTTP, replace `<version>` with a [published image version](https://github.com/orgs/AstralBeamAI/packages/container/package/astralbeam-platform), then start Platform on host loopback:

   ```sh
   docker run -d --name astralbeam-platform --restart unless-stopped --stop-timeout 15 \
     --env-file ./astralbeam.env -p 127.0.0.1:3000:3000 'ghcr.io/astralbeamai/astralbeam-platform:<version>'
   ```

3. For local setup, open http://localhost:3000/configure and follow [Complete setup](#6-complete-setup). For public Linux hosting, use this command instead of step 2. Remove `ALLOW_INSECURE` from `./astralbeam.env` and set `APP_BASE_URL` to your HTTPS origin. [Host networking](https://docs.docker.com/engine/network/drivers/host/) lets the host proxy connect over loopback, which is always trusted for forwarded host/protocol:

   ```sh
   docker run -d --name astralbeam-platform --restart unless-stopped --stop-timeout 15 \
     --env-file ./astralbeam.env --network host --env HOST=127.0.0.1 'ghcr.io/astralbeamai/astralbeam-platform:<version>'
   ```

   Configure the [host Nginx proxy](#5-put-it-behind-a-reverse-proxy), then open your HTTPS origin's `/configure` page and follow [Complete setup](#6-complete-setup).

If startup fails, inspect `docker logs astralbeam-platform`. The server needs a writable, executable `/tmp`.

Images use release version tags. To upgrade, [back up the database, storage, and keyring](./operations.md#backups-and-restore), stop and remove the old container, then repeat steps 2 and 3 with the new image. Recreate containers after environment changes. The binary's `upgrade` command does not upgrade containers, and older images cannot undo migrations.

To build for the host architecture, run `docker build -f platform/Dockerfile -t astralbeam-platform .` from the repository root.

## Binary on Linux

The following steps target a Linux host with systemd and `sudo`. Container users can continue at [Complete setup](#6-complete-setup).

## 1. Get a release binary

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

For a fork, or a target without a prebuilt asset, we build the binary ourselves. Bun is the only supported toolchain.

With the [Bun version named in `.bun-version`](https://bun.sh/docs/installation) installed, run these commands from the repository root to install the frozen dependencies, build the SDK the platform bundles, and build the binary:

```sh
bun install --frozen-lockfile
bun run --cwd sdk build
bun run --cwd platform build
```

**NOTE**: Do not run `scripts/setup.sh` on a deployment host. It installs contributor dependencies, applies migrations, and seeds uninitialized loopback databases with fixed development credentials.

The binary lands at `platform/.output/astralbeam-platform`. The server needs a writable system temporary directory, where it unpacks its bundled dependencies and static assets at startup. Normal shutdown removes those files. Bun does not need to be installed on the deployment host.

## 2. Provision the database

PostgreSQL 18 is the minimum. Production deployments should connect through a dedicated account with limited privileges, instead of the `postgres` superuser.

Run these commands to create that role and an empty database it owns:

```sh
createuser --pwprompt astralbeam
createdb --owner=astralbeam astralbeam
```

The application owns its schema from there. The first migration creates the `citext` extension, so the role must be permitted to run `CREATE EXTENSION`.

Connect directly to PostgreSQL or use a [transaction pooler](./operations.md#connection-pooling).

## 3. Set the bootstrap environment

Set `NODE_ENV=production` when launching standalone binaries in production. The Docker image already sets it. Database variables are read once per process, so changing either needs a restart.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection URL, for example `postgresql://user:password@host:5432/database` |
| `DATABASE_ENCRYPTION_KEY` | Yes | Comma-separated keyring. Each entry is 32 to 1024 characters and unique. The first entry encrypts new writes and is the operator sign-in credential |
| `PORT` | No | TCP port to listen on |
| `HOST` | No | HTTP bind address. Set `127.0.0.1` behind a proxy on the same host |
| `APP_BASE_URL` | No | Environment override for the base URL setting, which can otherwise be set at `/configure` |
| `TRUST_PROXY` | No | Defaults to `false`: trust loopback for host/protocol and ignore client IP headers. Set remote proxy socket-peer IPs/CIDRs before first start or upgrade. Use `127.0.0.1,::1` to enable client IP headers for only a same-host proxy, or `true` to trust all proxies. See [Reverse proxy trust](./security.md#reverse-proxy-trust) |
| `ALLOW_INSECURE` | No | Set exactly `true` to allow HTTP in production. Keep unset for TLS. See [Security](./security.md#https-and-response-headers) |
| `CLUSTER_RUNNER_HOST` | No | Address used to bind and advertise this runner. Defaults to `auto`: discover private IPv6, then private IPv4, falling back to loopback. Override with a reachable private hostname or IP if discovery selects the wrong interface |
| `CLUSTER_RUNNER_PORT` | No | Private runner port. Defaults to `0`, which publishes an OS-assigned port after binding |

Replicas sharing a database discover each other through Effect's SQL runner storage, without seed addresses. The discovered private addresses and assigned ports must be reachable between replicas. Override the host or port when network routing or firewall rules require it. See [cluster operations](./operations.md#cluster-readiness-and-recovery) for storage privileges and recovery.

Keep runner ports on a trusted private network because they expose internal cluster RPCs. Do not forward them through the public reverse proxy or advertise a shared load balancer address. These settings are environment-only and changing them requires restarting the process.

The binary loads [Bun's standard environment files](https://bun.com/docs/runtime/environment-variables) from the current working directory according to `NODE_ENV`. Existing environment variables take precedence.

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

Bootstrap applies migrations and appends a generated encryption key to `.env.local` when none is configured. It preserves existing file content and reuses an existing key. Keep the file private and back up the keyring separately. Use its active key to sign in at `/configure`.

When either database variable is missing from the environment, `start` reads it from `~/.astralbeam/platform.json`. Run interactively, it prompts for any variable still missing and saves the answer there, readable only by you. At startup it prints whether each value came from the environment or that file, and the environment always wins.

Run this command to generate a high-entropy encryption value:

```sh
openssl rand -base64 32
```

Keep it in your deployment's secret manager. Hashing does not rescue a weak passphrase, and losing an entry can make values encrypted with it unrecoverable.

A rejected value reports `DATABASE_ENCRYPTION_KEY must be a comma-separated list of unique secrets containing 32 to 1,024 characters each`, and a missing URL reports `'DATABASE_URL' environment variable is not set`. The binary exits before server startup when the key is missing or invalid. Development servers show the "Server restart required" page at `/configure` when either variable is missing or invalid.

## 4. Start the server

Run the binary as the service account created in step 3. It loads `.env.local` from its working directory.

Save this unit as `/etc/systemd/system/astralbeam-platform.service`:

```text title="astralbeam-platform.service"
[Unit]
Description=AstralBeam
After=network-online.target

[Service]
User=astralbeam
WorkingDirectory=/etc/astralbeam
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=3000
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

`systemctl status astralbeam-platform` should now report the service as active, and `curl -i http://127.0.0.1:3000/api/status` should answer `{"status":"ok"}`. The process logs to stdout and stderr, which systemd captures, and exits on SIGTERM, so `systemctl restart` and `systemctl stop` are both clean.

**NOTE**: The development server runs on port 4500. A production process listens on whatever `PORT` says.

## 5. Put it behind a reverse proxy

Terminate TLS at the proxy, bind the application to loopback, and let nothing else reach the origin. Loopback is always trusted for forwarded host/protocol, so HTTPS `/configure` works without a proxy setting. To use forwarded client IPs, enable Trust Proxy and enter `127.0.0.1,::1` to limit trust to the same-host proxy. For remote proxies, add their socket-peer IPs/CIDRs and retain a `TRUST_PROXY` environment override for operator recovery when database settings are unavailable. See [Reverse proxy trust](./security.md#reverse-proxy-trust).

Add this location block to the server that terminates TLS:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;
}
```

The application replaces configured client IP headers with the real peer address whenever the peer is untrusted, so a direct client cannot spoof the address authentication rate limits are keyed on.

The encryption key grants access to every encrypted value in the database, so `/configure` deserves more protection than the application's own throttle. Restrict who can reach it at the ingress with an IP allowlist, a VPN, or an identity-aware proxy, and rate-limit it there during first setup. See [Security](./security.md).

## 6. Complete setup

Open your deployment's `/configure` page in a browser. Application pages redirect there until setup is complete.

1. Sign in with the first entry of `DATABASE_ENCRYPTION_KEY`. Database credentials and fallback keyring entries are not accepted, and a wrong value reports `Invalid encryption key`.
2. The page shows any pending migrations with their SQL. Expand and review them, then apply them. See [Operations](./operations.md).
3. Fill in the required settings in [Configuration](./configuration.md), including private storage and both Turnstile keys. Configure and test email delivery, then choose **Save**. The authentication secret is generated on the first save if left unset. Each organization configures connections in [Models](/docs/dashboard/models) and assigns enabled models to its [agents](/docs/dashboard/agents).
4. Under **Owner onboarding**, choose **Invite owner**, then use the email to set the owner's password. If delivery fails, fix [email delivery](./configuration.md#email-delivery) and retry **Invite owner**.
5. Once configuration and owner onboarding are complete, use **Go to app**, which ends the operator session and loads the application. Continue with [Quickstart](/docs/start/quickstart) to embed your first chat.

Sessions last 15 minutes and sign-in is throttled to 5 attempts per minute, so keep the key at hand while you work through the form.

## 7. Verify the deployment

Run each of these against the public origin:

| Check | Expected |
| --- | --- |
| `curl -i https://your-host/api/status` | `200` with `{"status":"ok"}` and `X-Content-Type-Options: nosniff` |
| `curl -sI https://your-host/docs` | `200` with `Cache-Control: public, no-cache` and an `ETag` |
| `curl -s https://your-host/api/openapi.json` | The OpenAPI document, including the `/api/v1/tenants` path |
| `curl -i https://your-host/api/v1/tenants` | `401` once setup is complete, `503` with `Retry-After` while it is not |

`/api/status` counts organization rows and answers `{"status":"ok"}` when that query succeeds. A database failure returns `503` with an `error` field, without the count. There is no separate readiness endpoint, so to check API readiness, call an API route and treat `503` as not ready.

## Upgrade the binary

Let's move a running deployment to a newer release. Read the release notes first, and back up the database before an upgrade that carries migrations.

The service account needs a writable, executable temporary directory. Set `TMPDIR` if the system default is restricted. Existing environment and bootstrap settings remain in use after an upgrade.

Before upgrading an existing deployment behind a remote TLS-terminating proxy, set `TRUST_PROXY` to its socket-peer IPs/CIDRs in the service environment. Same-host loopback proxies need no setting for HTTPS `/configure` access. Without an allowlist for a remote proxy, HTTPS `/configure` requests redirect back to HTTPS and mutations are rejected.

1. Run this command to replace the installed binary with the latest release for this host's target:

   ```sh
   sudo astralbeam-platform upgrade
   ```

   Pass a tag to select a release, such as `sudo astralbeam-platform upgrade v0.23.7`. The command downloads the host's asset, verifies `SHA256SUMS`, and replaces the binary after confirmation. Releases before v0.13.4 have no checksum file and are unsupported by this command. Use `--yes` for non-interactive upgrades. Source checkouts must pull and rebuild instead.

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
