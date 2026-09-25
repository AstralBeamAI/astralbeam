# Deploy

Let's install AstralBeam on a Linux host, with PostgreSQL behind a connection pooler and a reverse proxy in front. Basic knowledge of Linux, systemd, and TLS termination is assumed here. [Overview](./overview.md) describes what the finished deployment consists of.

## 1. Get a release binary

Every tagged release from v0.13.0 publishes prebuilt platform assets named `astralbeam-platform-<target>`, where `<target>` is `linux-x86_64`, `linux-arm64`, `macos-x86_64`, `macos-arm64`, or `windows-x86_64.exe`. The `astralbeam-<target>` assets beside them are the [CLI](/docs/cli/getting-started), not the server. Earlier releases put the version in each asset name, such as `astralbeam-platform-v0.12.2-linux-x86_64`.

Run these commands to download the latest x86_64 asset and install it as `astralbeam-platform`. On an arm64 host, replace `linux-x86_64` with `linux-arm64`:

```sh
curl -fsSLo astralbeam-platform https://github.com/AstralBeamAI/astralbeam/releases/latest/download/astralbeam-platform-linux-x86_64
chmod +x astralbeam-platform
mv astralbeam-platform /usr/local/bin/astralbeam-platform
```

**TIP**: To pin a release instead, replace `latest/download` with `download/v<version>` in the URL, for example `download/v0.13.0`.

The release carries no checksum or signature file, so nothing here verifies where a download came from. Running it is only a smoke check. `astralbeam-platform version` prints the release version and target, such as `astralbeam-platform 0.13.3 (linux-x86_64)`, and `astralbeam-platform --help` lists every command. With the two bootstrap variables set, it must answer `GET /api/status` with `{"status":"ok"}` and exit on SIGTERM. CI smoke-tests the `linux-x86_64` binary the same way, without the database-backed status check, and cross-compiles the other targets unrun.

For a fork, or a target without a prebuilt asset, we build the binary ourselves. Deno is the only supported toolchain.

With [Deno installed](https://docs.deno.com/runtime/getting_started/installation/), run these commands from the repository root to install the frozen dependencies, build the SDK the platform bundles, and build the binary:

```sh
(cd sdk && deno install --frozen)
deno task --cwd sdk build
(cd platform && SHARP_IGNORE_GLOBAL_LIBVIPS=1 deno install --frozen)
deno task --cwd platform build
```

**NOTE**: Do not run `scripts/setup.sh` on a deployment host. It is the contributor setup, and it migrates any database `DATABASE_URL` reaches and seeds it with fixed development credentials.

The binary lands at `platform/.output/astralbeam-platform`. `build` writes the Nitro server bundle and static assets into `platform/.output`, then compiles them into the binary.

Run this command to smoke-test the binary the way CI does:

```sh
deno task --cwd platform binary:check
```

It rejects a binary over 200 MiB, requires `version` and `--version` to print the platform version and `--help` to list `migrate` and `upgrade`, starts it on a free loopback port, and requires the status endpoint, the built stylesheet, `/api/openapi.json` with its cache and CORS headers, a docs page that revalidates with an `ETag`, and a clean exit within 5 seconds of SIGTERM. With `BINARY_CHECK_DATABASE_URL` pointing at an empty database, as in CI, it also requires `migrate --dry-run` to list every embedded migration and leave no tables behind. It prints `Binary smoke check passed` with the binary's size when all of that holds.

**TIP**: You can skip the binary and run the same commands with `deno task --cwd platform start`, which needs the repository, its installed dependencies, and a fresh `build` on the host.

## 2. Provision the database

PostgreSQL 18 is the minimum. Production deployments should connect through a dedicated account with limited privileges, instead of the `postgres` superuser.

Run these commands to create that role and an empty database it owns:

```sh
createuser --pwprompt astralbeam
createdb --owner=astralbeam astralbeam
```

The application owns its schema from there. The first migration creates the `citext` extension, so the role must be permitted to run `CREATE EXTENSION`.

Point `DATABASE_URL` at a transaction-pooling pooler rather than at PostgreSQL directly. The application sends prepared queries, so we must give the pooler a prepared statement allowance as well. With PgBouncer that means `pool_mode = transaction` and a non-zero `max_prepared_statements`, which the reference Compose setup sets to 200.

**NOTE**: A pooler in transaction mode without a prepared statement allowance fails queries as soon as a statement is prepared.

## 3. Set the bootstrap environment

Only two variables are required. Both are read once per process, so changing either needs a restart.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection URL, for example `postgresql://user:password@host:5432/database` |
| `DATABASE_ENCRYPTION_KEY` | Yes | Comma-separated keyring. Each entry is 32 to 1024 characters and unique. The first entry encrypts new writes and is the operator sign-in credential |
| `PORT` | No | TCP port to listen on |
| `APP_BASE_URL` | No | Environment override for the base URL setting, which can otherwise be set at `/configure` |
| `CLUSTER_RUNNER_HOST` | No | Private hostname or IP advertised to peer runners. Defaults to `127.0.0.1` |
| `CLUSTER_RUNNER_PORT` | No | Private runner port. Defaults to `0`, which publishes an OS-assigned port after binding |
| `CLUSTER_RUNNER_LISTEN_HOST` | No | Bind interface for the private runner listener. Defaults to `CLUSTER_RUNNER_HOST` |

Each process starts an embedded cluster runner and lets Effect initialize or migrate its `effect_cluster_*` tables automatically. The runtime database role needs USAGE and CREATE on the target schema and ownership of existing cluster tables for upgrades. See [cluster operations](./operations.md#cluster-readiness-and-recovery). For replicas on different machines or isolated container networks, set an individually reachable private runner host and port for each process. Peers must reach that address directly. Use a fixed port where firewall rules or container mappings require one. A wildcard listen host such as `0.0.0.0` still needs an explicit, reachable advertised host.

Keep runner ports on a trusted private network because they expose internal cluster RPCs. Do not forward them through the public reverse proxy or advertise a shared load balancer address. These settings are environment-only and changing them requires restarting the process.

When either database variable is missing from the environment, `astralbeam-platform` reads it from `~/.astralbeam/platform.json`. Run interactively, it prompts for any variable still missing and saves the answer there, readable only by you. At startup it prints whether each value came from the environment or that file, and the environment always wins.

Run this command to generate a high-entropy encryption value:

```sh
openssl rand -base64 32
```

Keep it in your deployment's secret manager. The keyring is hashed into key material, so length and hashing do not rescue a weak passphrase, and losing the first entry means losing every stored secret.

A rejected value reports `DATABASE_ENCRYPTION_KEY must be a comma-separated list of unique secrets containing 32 to 1,024 characters each`, and a missing URL reports `'DATABASE_URL' environment variable is not set`. With either variable missing or invalid, `/configure` renders a "Server restart required" page naming the offending variables instead of the editor.

## 4. Start the server

To keep the server running even after we log out of the host, we must set it up as a Linux system service, owned by an unprivileged user.

Save this unit as `/etc/systemd/system/astralbeam-platform.service`:

```ini
[Unit]
Description=AstralBeam
After=network-online.target

[Service]
User=astralbeam
EnvironmentFile=/etc/astralbeam/env
Environment=PORT=3000
ExecStart=/usr/local/bin/astralbeam-platform
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Keep `DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` in the `EnvironmentFile` rather than in the unit, and restrict that file to the service user.

Run these commands to load the unit and start the service:

```sh
systemctl daemon-reload
systemctl enable --now astralbeam-platform
```

`systemctl status astralbeam-platform` should now report the service as active, and `curl -i http://127.0.0.1:3000/api/status` should answer `{"status":"ok"}`. The process logs to stdout and stderr, which systemd captures, and exits on SIGTERM, so `systemctl restart` and `systemctl stop` are both clean.

**NOTE**: The development server runs on port 4500. A production process listens on whatever `PORT` says.

## 5. Put it behind a reverse proxy

Terminate TLS at the proxy, bind the application to loopback, and let nothing else reach the origin. `/configure` trusts `X-Forwarded-Host` and `X-Forwarded-Proto` only when the request peer is a loopback address, so the proxy must run on the same host as the application, must overwrite both headers, and must not be bypassable.

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

The application replaces `X-Forwarded-For` with the real peer address whenever the peer is not loopback, so a client cannot spoof the address authentication rate limits are keyed on.

The encryption key grants access to every encrypted value in the database, so `/configure` deserves more protection than the application's own throttle. Restrict who can reach it at the ingress with an IP allowlist, a VPN, or an identity-aware proxy, and rate-limit it there during first setup. See [Security](./security.md).

## 6. Complete setup

Open `https://your-host/configure` in a browser. Every other page redirects there until setup is complete.

1. Sign in with the first entry of `DATABASE_ENCRYPTION_KEY`. Database credentials and fallback keyring entries are not accepted, and a wrong value reports `Invalid encryption key`.
2. On a new database, the page shows the pending migrations with their SQL. Expand and review them, then apply them. See [Operations](./operations.md).
3. Fill in the required settings: the application base URL, the Cloudflare Turnstile site and secret keys, and the authentication secret, which is generated for you on the first save if you leave it unset. Add email delivery and OAuth clients as needed. Model provider keys are not here: each organization sets its own OpenAI API key in the dashboard. Every setting is described in [Configuration](./configuration.md).
4. When the page reports "Configuration is complete", use **Go to app**, which ends the operator session and loads the application.

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

## Upgrade

Let's move a running deployment to a newer release. Read the release notes first, and back up the database before an upgrade that carries migrations.

1. Run this command to replace the installed binary with the latest release for this host's target:

   ```sh
   sudo astralbeam-platform upgrade
   ```

   To pin a release instead, pass its tag, as in `sudo astralbeam-platform upgrade v0.13.3`. The command downloads the matching `astralbeam-platform-<target>` asset from GitHub and swaps it in place after you confirm, and it supports releases from v0.13.0. Pass `-y` or `--yes` to skip the confirmation, which a run without a terminal needs because it cannot answer the prompt. It needs `sudo` only because `/usr/local/bin` belongs to root. Like the manual download, it verifies no checksum or signature.

2. Run this command with the new binary to apply the release's migrations, as described in [database commands](./operations.md#database-commands):

   ```sh
   astralbeam-platform migrate
   ```

   It prompts for `DATABASE_URL` when neither the environment nor [the saved file](#3-set-the-bootstrap-environment) has it. You can skip this step and apply them from `/configure` after the restart instead, where the gate redirects every page until you review and apply the new SQL.

3. Run this command to restart the service, since the running process keeps serving the old binary until then:

   ```sh
   systemctl restart astralbeam-platform
   ```

4. Upgrade and restart every other replica so each one reloads configuration and migration state.

Downgrading is not supported, because a migration has no rollback. `upgrade` accepts an older tag but warns that applied migrations stay applied. Reverse a schema change with a forward migration instead.
