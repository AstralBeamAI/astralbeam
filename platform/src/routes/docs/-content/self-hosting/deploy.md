# Deploy

Install the standalone binary to run AstralBeam with its own database, file storage, and local sandbox. Use [Docker Compose](#docker-compose) if you prefer containers.

## Standalone binary

Use Linux x86_64 or ARM64 with glibc 2.36+ and KVM enabled, or Apple Silicon with macOS 15+. The local sandbox needs [host virtualization support](https://github.com/superradcompany/microsandbox#readme). Embedded PostgreSQL is experimental.

Choose an empty working directory with no `DATABASE_URL` override, and run these commands as a regular user, without `sudo`:

```sh
curl -fsSL https://astralbeam.ai/install.sh | sh
~/.local/bin/astralbeam-platform bootstrap --standalone
HOST=127.0.0.1 ~/.local/bin/astralbeam-platform start
```

The installer verifies the release checksum and installs to `~/.local/bin`. Bootstrap downloads the local runtimes and sandbox image, generates private settings, and applies migrations. Later starts reuse those files. No Bun, Docker, or separately managed database is needed for this path.

Open http://localhost:4510/configure and [complete setup](#complete-setup). Run later commands from the same working directory so the binary finds its `.env` file. Stop with Ctrl+C.

See [other installations](#other-binary-installations) for other hosts, or `astralbeam-platform bootstrap --help` for individual runtime options.

## Complete setup

1. Sign in at `/configure` with the active encryption key. For a fresh standalone installation, use `encryptionKey` from `embedded-postgres.json` in the [data directory](./operations.md#data-directory). If you supplied `DATABASE_ENCRYPTION_KEY`, use its first entry instead.
2. Review and apply any pending migrations.
3. Configure and test [email delivery](./configuration.md#email-delivery). Enter the [default OpenAI API key](./configuration.md#models) that new organizations start with, review the required authentication and storage settings, then choose **Save**.
4. Under **Owner onboarding**, choose **Invite owner** and follow the email to set the owner's password.
5. Choose **Go to app** and follow the dashboard's integration guide, or the [Quickstart](/docs/start/quickstart), to embed chat.

Operator sessions last 15 minutes. Keep the encryption key private and back it up separately. If the invitation fails, fix email delivery and retry **Invite owner**.

## Public deployment

Bootstrap starts new installations with local testing defaults. Before making the application public:

- Set `ALLOW_INSECURE=false` and `SKIP_EMAIL_VERIFICATION=false` in `.env`.
- Replace both Turnstile test keys with keys restricted to your hostname.
- Set the application base URL to your public HTTPS origin.
- Bind the application to loopback and put it behind an [HTTPS reverse proxy](#https-reverse-proxy). Restrict `/configure` with an IP allowlist, VPN, or identity-aware proxy.
- Preserve the working directory, [data directory](./operations.md#data-directory), and encryption keyring across restarts and upgrades.

Restart after environment changes. For multiple application replicas, use [external PostgreSQL](#external-postgresql) and shared S3-compatible storage.

### Run as a service

On Linux with systemd, run the binary as the same unprivileged user that completed bootstrap. Replace the user and absolute paths below with your installation, then save it as `/etc/systemd/system/astralbeam-platform.service`:

```text title="astralbeam-platform.service"
[Unit]
Description=AstralBeam
After=network-online.target

[Service]
User=your-user
WorkingDirectory=/absolute/path/to/your/installation
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=4510
ExecStart=/home/your-user/.local/bin/astralbeam-platform start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now astralbeam-platform
```

Check `systemctl status astralbeam-platform` and `curl -i http://127.0.0.1:4510/api/status`. A healthy database returns `200` with `{"status":"ok"}`. Logs are available through `journalctl -u astralbeam-platform`.

### HTTPS reverse proxy

Add this location block to an Nginx server that terminates TLS:

```nginx
location / {
  proxy_pass http://127.0.0.1:4510;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;
}
```

Loopback is already trusted for forwarded host and protocol. To use forwarded client IPs, enable **Trust Proxy** and enter `127.0.0.1,::1` as its allowlist. For a remote proxy, set `TRUST_PROXY` to its actual peer IPs/CIDRs before starting. Keep the origin unreachable by other clients. See [Reverse proxy trust](./security.md#reverse-proxy-trust).

Verify the public origin's `/api/status` returns `200`. An unauthenticated `/api/v1/tenants` request returns `401` once setup is ready, or `503` while configuration or migrations are incomplete.

## Upgrade the binary

Read the release notes and [back up the database, files, and keyring](./operations.md#backups-and-restore). Stop the running application before migrating an embedded database. From the service's working directory, using the same user, environment, and data directory:

```sh
~/.local/bin/astralbeam-platform upgrade
~/.local/bin/astralbeam-platform migrate
```

Restart the application afterward. For systemd, use `sudo systemctl restart astralbeam-platform`. Restart every replica when using an external database.

The upgrade command verifies the release checksum and asks before replacing the binary. Use `upgrade --help` for release selection and automation options. Source installations must rebuild. Downgrades cannot undo migrations and are unsupported.

## Other binary installations

The installer supports macOS and Linux, with `--version` and `--install-dir` options available through its `--help`. Manual binaries, including Windows x86_64, are available from [GitHub releases](https://github.com/AstralBeamAI/astralbeam/releases). Choose `astralbeam-platform-<target>` for the server. Assets named `astralbeam-<target>` are the [CLI](/docs/cli/getting-started).

For a custom build, install the [Bun version named in `.bun-version`](https://bun.sh/docs/installation), then run from the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd sdk build
bun run --cwd platform build
```

The binary is written to `platform/.output/astralbeam-platform`. Use that path for the bootstrap and start commands. It needs a writable, executable temporary directory at runtime. Checksums verify download integrity, not publisher identity. Releases are unsigned.

**NOTE**: Do not run `scripts/setup.sh` on a deployment host. It installs contributor dependencies and can seed development credentials.

### External PostgreSQL

Use PostgreSQL 18 or newer and a dedicated application role rather than the `postgres` superuser:

```sh
createuser --pwprompt astralbeam
createdb --owner=astralbeam astralbeam
```

The role needs permission to create the required extensions. Set `DATABASE_URL` and a high-entropy `DATABASE_ENCRYPTION_KEY` in a private `.env` file before running `bootstrap`. Generate a key with `openssl rand -base64 32`. Keep an existing deployment's original keyring. Environment values take precedence over saved settings. See [Configuration](./configuration.md#environment-overrides) and [Connection pooling](./operations.md#connection-pooling).

### Embedded PostgreSQL

Standalone bootstrap saves `DATABASE_URL=embedded` in `.env` for later starts and migrations. Keep the generated `embedded-postgres.json` credentials with the database. An external `DATABASE_URL` overrides this selection. Stop Platform before running database maintenance. See [Backups and restore](./operations.md#backups-and-restore).

### Local sandbox image

`LOCAL_SANDBOX_IMAGE` selects the shared Docker and Microsandbox image. Bootstrap prepares the release-tagged default and reuses cached images on later runs. To change it, stop Platform, set a new tag or digest in `.env`, rerun `bootstrap`, and restart. Organization settings cannot override this image.

## Containers

### Docker Compose

This stack creates a local evaluation with PostgreSQL and persistent File System storage. Existing S3 installations should keep their current Compose file and storage settings.

In an empty directory, download the Compose file and create a private `.env` once. The command refuses to overwrite an existing file:

```sh
curl -fsSLO https://raw.githubusercontent.com/AstralBeamAI/astralbeam/v0.28.3/docker-compose.production.yml
(
  umask 077
  set -C
  printf 'ASTRALBEAM_VERSION=%s\nPOSTGRES_PASSWORD=%s\nDATABASE_ENCRYPTION_KEY=%s\nBETTER_AUTH_SECRET=%s\nALLOW_INSECURE=true\nSKIP_EMAIL_VERIFICATION=true\nTURNSTILE_SITE_KEY=1x00000000000000000000AA\nTURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA\n' \
    "${ASTRALBEAM_VERSION:-0.28.3}" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" \
    > .env
)
docker compose -f docker-compose.production.yml up --detach --wait
```

Open http://localhost:4510/configure and [complete setup](#complete-setup). Configure email before inviting the owner. The stack binds to localhost and stores files at `/var/lib/astralbeam/storage` in its persistent volume. Its HTTP, verification, and Turnstile defaults are for local evaluation.

To upgrade, [back up](./operations.md#backups-and-restore), set `ASTRALBEAM_VERSION` to the new release in `.env`, rerun the startup command, and apply pending migrations. `docker compose -f docker-compose.production.yml down` preserves data. **Adding `--volumes` deletes the database and files.** If existing uploads are at the volume root, stop Platform, back up, and move them into `storage/`, preserving ownership.

### Existing services

For public Linux hosting, provision [PostgreSQL](#external-postgresql) and email separately. Create a private `./astralbeam.env` with `DATABASE_URL`, `DATABASE_ENCRYPTION_KEY`, `APP_BASE_URL=https://your-host`, and `STORAGE_PROVIDER=filesystem`. Keep `ALLOW_INSECURE` unset and `SKIP_EMAIL_VERIFICATION=false`.

Replace `<version>` with a [published image version](https://github.com/orgs/AstralBeamAI/packages/container/package/astralbeam-platform):

```sh
docker run -d --name astralbeam-platform --restart unless-stopped --stop-timeout 15 \
  --env-file ./astralbeam.env --network host --env HOST=127.0.0.1 --env PORT=4510 \
  --mount source=astralbeam-files,target=/var/lib/astralbeam \
  'ghcr.io/astralbeamai/astralbeam-platform:<version>'
```

Configure the [host HTTPS proxy](#https-reverse-proxy), then [complete setup](#complete-setup). The image supports Linux AMD64 and ARM64 and prepares its data directory for UID/GID `10001:10001`. Use S3-compatible storage for replicas on different hosts.

To upgrade, back up first, stop and remove the old container, then repeat the command with the new image and apply migrations at `/configure`. Recreate containers after environment changes. Inspect startup failures with `docker logs astralbeam-platform`.
