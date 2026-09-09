# Deploy

This page installs AstralBeam on one Linux host with PostgreSQL behind a connection pooler and a reverse proxy in front. Read [Overview](./overview.md) first for what the deployment consists of.

## Get a release binary

Each tagged release publishes one prebuilt asset, `astralbeam-v<version>-linux-x86_64`, built for Linux on x86_64. There is no container image and no package for other platforms, so build from source for anything else.

```sh
gh release download v0.1.0 --repo AstralBeamAI/astralbeam --pattern 'astralbeam-*-linux-x86_64'
chmod +x astralbeam-v0.1.0-linux-x86_64
mv astralbeam-v0.1.0-linux-x86_64 /usr/local/bin/astralbeam
```

The release carries no checksum or signature file. Verify what you downloaded by running it: with the two bootstrap variables set, it must answer `GET /api/status` with `{"status":"ok"}` and exit on SIGTERM. The same checks run in CI on every release.

## Or build from source

Deno is the only supported toolchain. From the repository root, install the frozen dependencies once, then build and compile.

```sh
./scripts/setup.sh
deno task --cwd webapp build
deno task --cwd webapp compile
```

Order matters: `build` writes the Nitro server bundle and static assets into `webapp/.output`, and `compile` embeds that output into `webapp/.output/astralbeam`. Compiling without a fresh build ships stale assets.

To run the same smoke check CI runs, use `deno task --cwd webapp binary:check`. It compiles, then rejects a binary over 200 MiB, starts it on a free loopback port, and requires the status endpoint, the built stylesheet, `/api/openapi.json` with its cache and CORS headers, a docs page that revalidates with an `ETag`, and a clean exit within 5 seconds of SIGTERM.

You can also skip `compile` and run the server bundle directly with `deno task --cwd webapp start`, which needs the repository and its installed dependencies on the host. The binary is the simpler artifact to copy to a server.

## Provision the database

PostgreSQL 18 is the minimum. Create a dedicated role and database, and let the application own its schema.

```sh
createuser --pwprompt astralbeam
createdb --owner=astralbeam astralbeam
```

Migrations create the `citext` extension, which needs a role permitted to run `CREATE EXTENSION` on first migration. Point `DATABASE_URL` at a transaction-pooling pooler rather than PostgreSQL directly, and give the pooler a prepared statement allowance, because the application sends prepared queries. With PgBouncer that means `pool_mode = transaction` and a non-zero `max_prepared_statements`, which the reference Compose setup sets to 200. A pooler configured without it fails queries once a statement is prepared.

## Set the bootstrap environment

Only two variables are required. Both are read once per process, so changing either needs a restart.

| Variable                  | Required | Notes                                                                                                                                               |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Yes      | PostgreSQL connection URL, for example `postgresql://user:password@host:5432/database`                                                              |
| `DATABASE_ENCRYPTION_KEY` | Yes      | Comma-separated keyring. Each entry is 32 to 1024 characters and unique. The first entry encrypts new writes and is the operator sign-in credential |
| `PORT`                    | No       | TCP port to listen on                                                                                                                               |
| `APP_BASE_URL`            | No       | Environment override for the base URL setting, which can otherwise be set at `/configure`                                                           |

Generate the encryption value with high entropy and keep it in your secret manager:

```sh
openssl rand -base64 32
```

The keyring is hashed into key material, so length and hashing do not rescue a weak passphrase. Losing the first entry means losing every stored secret. A rejected value reports `DATABASE_ENCRYPTION_KEY must be a comma-separated list of unique secrets containing 32 to 1,024 characters each`, and a missing URL reports `'DATABASE_URL' environment variable is not set`. With either variable missing or invalid, `/configure` renders a "Server restart required" page naming the offending variables instead of the editor.

## Start the server

Run the binary under a process manager as an unprivileged user. A minimal systemd unit:

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

Keep `DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` in the `EnvironmentFile` rather than in the unit, and restrict that file to the service user. The process serves HTTP on `PORT`, logs to stdout and stderr, and exits on SIGTERM, so `systemctl restart` and `systemctl stop` are clean. The development server, by contrast, runs on port 4500.

## Put it behind a reverse proxy

Terminate TLS at the proxy, bind the application to loopback, and let nothing else reach the origin. The application trusts `X-Forwarded-Host` and `X-Forwarded-Proto` on `/configure` only when the request peer is a loopback address, which is exactly why the proxy must be on the same host as the application, must overwrite both headers, and must not be bypassable. It also replaces `X-Forwarded-For` with the real peer address whenever the peer is not loopback, so authentication rate limits cannot be spoofed by a client header.

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;
}
```

Because the encryption key grants access to every encrypted value, restrict `/configure` further at the ingress with an IP allowlist, a VPN, or an identity-aware proxy, and rate-limit it there during first setup. See [Security](./security.md).

## Complete setup

Open `https://your-host/configure`. Any other page redirects there until setup is complete.

1. Sign in with the first entry of `DATABASE_ENCRYPTION_KEY`. Database credentials and fallback keyring entries are not accepted, and a wrong value reports `Invalid encryption key`.
2. On a new database, the page shows the pending migrations with their SQL. Expand and review them, then apply them. See [Operations](./operations.md).
3. Fill in the required settings: the application base URL, the Cloudflare Turnstile site and secret keys, and the authentication secret, which is generated for you on the first save if you leave it unset. Add email delivery, OAuth clients, and the OpenAI key as needed. Every setting is described in [Configuration](./configuration.md).
4. When the page reports "Configuration is complete", use **Go to app**. That ends the operator session and loads the application.

Sessions last 15 minutes, and sign-in is throttled to 5 attempts per minute, so keep the key at hand while you work through the form.

## Verify the deployment

| Check                                        | Expected                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `curl -i https://your-host/api/status`       | `200` with `{"status":"ok"}` and `X-Content-Type-Options: nosniff`     |
| `curl -sI https://your-host/docs`            | `200` with `Cache-Control: public, no-cache` and an `ETag`             |
| `curl -s https://your-host/api/openapi.json` | The OpenAPI document, including the `/api/v1/tenants` path             |
| `curl -i https://your-host/api/v1/tenants`   | `401` once setup is complete, `503` with `Retry-After` while it is not |

`/api/status` is a liveness probe only. It answers one constant body without touching the database, so it stays `200` even when configuration is incomplete or PostgreSQL is unreachable. There is no separate readiness endpoint. To check readiness, call an API route and treat `503` as not ready.

## Upgrade

1. Read the release notes, and back up the database before an upgrade that carries migrations.
2. Replace the artifact and restart. Stop the old process, swap the binary, and start the new one.
3. If the release added migrations, the gate closes and every page redirects to `/configure`. Sign in, review the new SQL, and apply it. Alternatively apply it ahead of the restart with `deno task --cwd webapp db migrate` from a checkout of the new version.
4. Restart every other replica so each one reloads configuration and migration state.

Downgrading is not supported, because there is no rollback for a migration. Reverse a schema change with a forward migration instead.
