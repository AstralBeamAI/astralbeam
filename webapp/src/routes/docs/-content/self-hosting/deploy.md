# Deploy

Let's install AstralBeam on a Linux host, with PostgreSQL behind a connection pooler and a reverse proxy in front. Basic knowledge of Linux, systemd, and TLS termination is assumed here. [Overview](./overview.md) describes what the finished deployment consists of.

## 1. Get a release binary

Every tagged release publishes one prebuilt asset, `astralbeam-v<version>-linux-x86_64`, built for Linux on x86_64.

Run these commands to download that asset and install it as `astralbeam`:

```sh
gh release download v0.1.0 --repo AstralBeamAI/astralbeam --pattern 'astralbeam-*-linux-x86_64'
chmod +x astralbeam-v0.1.0-linux-x86_64
mv astralbeam-v0.1.0-linux-x86_64 /usr/local/bin/astralbeam
```

The release carries no checksum or signature file, so verify what you downloaded by running it. With the two bootstrap variables set, it must answer `GET /api/status` with `{"status":"ok"}` and exit on SIGTERM. The same checks run in CI on every release.

For any other platform, and for a fork, we build the binary ourselves. Deno is the only supported toolchain.

Run these commands from the repository root to install the frozen dependencies, build, and compile:

```sh
./scripts/setup.sh
deno task --cwd webapp build
deno task --cwd webapp compile
```

The binary lands at `webapp/.output/astralbeam`. Order matters here: `build` writes the Nitro server bundle and static assets into `webapp/.output`, and `compile` embeds that output, so compiling without a fresh build ships stale assets.

Run this command to compile and smoke-test the binary the way CI does:

```sh
deno task --cwd webapp binary:check
```

It rejects a binary over 200 MiB, starts it on a free loopback port, and requires the status endpoint, the built stylesheet, `/api/openapi.json` with its cache and CORS headers, a docs page that revalidates with an `ETag`, and a clean exit within 5 seconds of SIGTERM. It prints `Binary smoke check passed` with the binary's size when all of that holds.

**TIP**: You can skip `compile` and run the server bundle with `deno task --cwd webapp start`, which needs the repository and its installed dependencies on the host.

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

| Variable                  | Required | Notes                                                                                                                                               |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Yes      | PostgreSQL connection URL, for example `postgresql://user:password@host:5432/database`                                                              |
| `DATABASE_ENCRYPTION_KEY` | Yes      | Comma-separated keyring. Each entry is 32 to 1024 characters and unique. The first entry encrypts new writes and is the operator sign-in credential |
| `PORT`                    | No       | TCP port to listen on                                                                                                                               |
| `APP_BASE_URL`            | No       | Environment override for the base URL setting, which can otherwise be set at `/configure`                                                           |

Run this command to generate a high-entropy encryption value:

```sh
openssl rand -base64 32
```

Keep it in your deployment's secret manager. The keyring is hashed into key material, so length and hashing do not rescue a weak passphrase, and losing the first entry means losing every stored secret.

A rejected value reports `DATABASE_ENCRYPTION_KEY must be a comma-separated list of unique secrets containing 32 to 1,024 characters each`, and a missing URL reports `'DATABASE_URL' environment variable is not set`. With either variable missing or invalid, `/configure` renders a "Server restart required" page naming the offending variables instead of the editor.

## 4. Start the server

To keep the server running even after we log out of the host, we must set it up as a Linux system service, owned by an unprivileged user.

Save this unit as `/etc/systemd/system/astralbeam.service`:

```ini
[Unit]
Description=AstralBeam
After=network-online.target

[Service]
User=astralbeam
EnvironmentFile=/etc/astralbeam/env
Environment=PORT=3000
ExecStart=/usr/local/bin/astralbeam
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Keep `DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` in the `EnvironmentFile` rather than in the unit, and restrict that file to the service user.

Run these commands to load the unit and start the service:

```sh
systemctl daemon-reload
systemctl enable --now astralbeam
```

`systemctl status astralbeam` should now report the service as active, and `curl -i http://127.0.0.1:3000/api/status` should answer `{"status":"ok"}`. The process logs to stdout and stderr, which systemd captures, and exits on SIGTERM, so `systemctl restart` and `systemctl stop` are both clean.

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
3. Fill in the required settings: the application base URL, the Cloudflare Turnstile site and secret keys, and the authentication secret, which is generated for you on the first save if you leave it unset. Add email delivery, OAuth clients, and the OpenAI key as needed. Every setting is described in [Configuration](./configuration.md).
4. When the page reports "Configuration is complete", use **Go to app**, which ends the operator session and loads the application.

Sessions last 15 minutes and sign-in is throttled to 5 attempts per minute, so keep the key at hand while you work through the form.

## 7. Verify the deployment

Run each of these against the public origin:

| Check                                        | Expected                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `curl -i https://your-host/api/status`       | `200` with `{"status":"ok"}` and `X-Content-Type-Options: nosniff`     |
| `curl -sI https://your-host/docs`            | `200` with `Cache-Control: public, no-cache` and an `ETag`             |
| `curl -s https://your-host/api/openapi.json` | The OpenAPI document, including the `/api/v1/tenants` path             |
| `curl -i https://your-host/api/v1/tenants`   | `401` once setup is complete, `503` with `Retry-After` while it is not |

`/api/status` counts organization rows and answers `{"status":"ok"}` when that query succeeds. A database failure returns `503` with an `error` field, without the count. There is no separate readiness endpoint, so to check API readiness, call an API route and treat `503` as not ready.

## Upgrade

1. Read the release notes, and back up the database before an upgrade that carries migrations.
2. Replace the artifact and restart. Stop the old process, swap the binary, and start the new one.
3. If the release added migrations, the gate closes and every page redirects to `/configure`. Sign in, review the new SQL, and apply it. You can also apply it ahead of the restart with `deno task --cwd webapp db migrate` from a checkout of the new version, run from the repository root.
4. Restart every other replica so each one reloads configuration and migration state.

Downgrading is not supported, because a migration has no rollback. Reverse a schema change with a forward migration instead.
