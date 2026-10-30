# AstralBeam hosting

This guide documents the production server's systemd services, Cloudflare proxy configuration, Caddy certificate setup, and application upgrade procedure. Keep real deployment secrets on the server and out of the repository.

## Systemd services

These unit files live under `/etc/systemd/system/`. The platform database URL and encryption key below are placeholders. Use the deployment's existing production values on the server.

### astralbeam-linearity.service

```ini
[Unit]
Description=Linearity playground
After=network-online.target

[Service]
WorkingDirectory=/root/work/astralbeam/examples/linearity-react
ExecStart=/root/.bun/bin/bun run --env-file=.env.production .output/server/index.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

### astralbeam-platform.service

```ini
[Unit]
Description=AstralBeam
After=network-online.target

[Service]
Environment="PORT=3100"
Environment="DATABASE_URL=postgres://username:password@host:5432/astralbeam"
Environment="DATABASE_ENCRYPTION_KEY=your-encryption-key"
ExecStart=/usr/local/bin/astralbeam-platform
Restart=always

[Install]
WantedBy=multi-user.target
```

### astralbeam-prototype.service

The prototype runs from a separate checkout and is managed outside the application upgrade script.

```ini
[Service]
WorkingDirectory=/root/work/astralbeam-prototype/webapp
Environment="NODE_ENV=production"
ExecStart=/root/.vite-plus/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
```

### astralbeam-website.service

```ini
[Unit]
Description=AstralBeam website
After=network-online.target

[Service]
Environment="PORT=4400"
WorkingDirectory=/root/work/astralbeam/website
ExecStart=/root/.bun/bin/bun run .output/server/index.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

After editing unit files, have systemd read the definitions before restarting the affected services:

```sh
sudo systemctl daemon-reload
```

## Cloudflare and origin routing

Proxy the apex, demo, and play DNS records through Cloudflare. Set SSL/TLS encryption to Full (strict), enable Always Use HTTPS, and set Minimum TLS Version to TLS 1.2 while keeping TLS 1.3 enabled. Caddy proxies `astralbeam.ai` to port 3100, `demo.astralbeam.ai` to port 3000, and `play.astralbeam.ai` to port 4900.

Enable <a href="https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/" target="_blank" rel="noopener noreferrer">HSTS at Cloudflare</a> with a one-month lifetime, the dashboard's shortest positive option. Keep subdomain coverage and preload off. Proxied HTTPS responses should contain `Strict-Transport-Security: max-age=2592000`, overriding the application's longer default policy for this deployment.

Cloudflare permanently redirects `www` and `app` to the apex, preserving paths and queries. Both redirect-only hosts use proxied placeholder A records (`192.0.2.1`) and need no Caddy host or origin certificate. API clients use `https://astralbeam.ai/api/...` directly.

Origin TCP port 443 remains public under this configuration. Caddy's `trusted_proxies` ranges control forwarded-header trust and do not block direct web access. Caddy rebuilds forwarded headers from the trusted visitor IP and the origin request's host and scheme. Keep SSH access separately allowed.

Cloudflare negotiates compression with visitors. Platform precompresses static assets with Brotli, Zstandard, and gzip, including in standalone binaries. Caddy preserves upstream encodings without adding its own compression handler, so some origin responses may remain uncompressed.

## Let's Encrypt DNS-01 setup

These commands assume Debian/Ubuntu, Caddy 2.8+ with the Cloudflare DNS module, `/usr/bin/caddy`, and the standard `caddy.service` reading `/etc/caddy/Caddyfile`. Repository changes do not update the server. Keep one terminal session through module installation because the commands reuse `caddy_build_dir`.

### Install the base APT package

Skip this section if the official APT Caddy package is already installed. The <a href="https://caddyserver.com/docs/install#debian-ubuntu-raspbian" target="_blank" rel="noopener noreferrer">official stable package</a> supplies the service, user, and configuration directory:

```sh
sudo apt update
sudo apt install --yes debian-keyring debian-archive-keyring apt-transport-https curl gpg nano
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install --yes caddy
```

### Back up the configuration and install the DNS module

Preserve any other required hosts in the server configuration. Back it up before editing:

```sh
sudo cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup-$(date +%Y%m%d-%H%M%S)"
```

For the first module installation, prepare a replacement binary without changing the running server. <a href="https://caddyserver.com/docs/command-line#caddy-add-package" target="_blank" rel="noopener noreferrer">Caddy's experimental `add-package` command</a> downloads the latest Caddy release with existing modules plus the requested module, without a local Go toolchain:

```sh
caddy_build_dir=$(mktemp -d)
cp /usr/bin/caddy "$caddy_build_dir/caddy"
sudo "$caddy_build_dir/caddy" add-package github.com/caddy-dns/cloudflare
"$caddy_build_dir/caddy" version
"$caddy_build_dir/caddy" list-modules
```

Continue only if these commands succeed and `dns.providers.cloudflare` appears. Run this <a href="https://caddyserver.com/docs/build#package-support-files-for-custom-builds-for-debianubunturaspbian" target="_blank" rel="noopener noreferrer">APT integration</a> once to retain the packaged binary as `caddy.default` and prevent package upgrades from replacing the custom build:

```sh
sudo install -o root -g root -m 0755 "$caddy_build_dir/caddy" /usr/bin/caddy.custom
sudo dpkg-divert --divert /usr/bin/caddy.default --rename /usr/bin/caddy
sudo update-alternatives --install /usr/bin/caddy caddy /usr/bin/caddy.default 10
sudo update-alternatives --install /usr/bin/caddy caddy /usr/bin/caddy.custom 50
sudo update-alternatives --set caddy /usr/bin/caddy.custom
```

### Create and store the Cloudflare token

In Cloudflare, open My Profile → API Tokens → Create Token → Create Custom Token. Grant `Zone → DNS → Edit` and `Zone → Zone → Read`, then set Zone Resources to Include → Specific zone → `astralbeam.ai`, as required by the <a href="https://github.com/caddy-dns/cloudflare" target="_blank" rel="noopener noreferrer">Cloudflare DNS module</a>. Store the token in a root-only file, keeping its real value out of shell commands and the Caddyfile:

```sh
sudo touch /etc/caddy/cloudflare.env
sudo chown root:root /etc/caddy/cloudflare.env
sudo chmod 600 /etc/caddy/cloudflare.env
sudo nano /etc/caddy/cloudflare.env
```

Replace the placeholder with the token:

```text
CLOUDFLARE_API_TOKEN=PASTE_YOUR_TOKEN_HERE
```

### Supply the token to the Caddy service

Systemd reads the root-only file and supplies the token to Caddy. Exporting it in an SSH shell does not supply it to the service:

```sh
sudo install -d -m 0755 /etc/systemd/system/caddy.service.d
sudo nano /etc/systemd/system/caddy.service.d/cloudflare-dns.conf
```

Paste this <a href="https://caddyserver.com/docs/running#environment-variables" target="_blank" rel="noopener noreferrer">systemd drop-in</a>. The `ExecStart` override removes the standard service's `--environ` flag so startup output does not expose the token:

```ini
[Service]
EnvironmentFile=/etc/caddy/cloudflare.env
ExecStart=
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
```

### Install the Caddy configuration

Open the server's Caddyfile, then paste the complete configuration below, preserving any other required hosts:

```sh
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
{
	email admin@astralbeam.ai

	cert_issuer acme {
		dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	}

	servers {
		# Trust visitor-IP headers only from Cloudflare peers. https://www.cloudflare.com/ips/
		trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
		trusted_proxies_strict
		client_ip_headers CF-Connecting-IP
	}
}

astralbeam.ai {
	reverse_proxy localhost:3100 {
		header_up X-Forwarded-For {client_ip}
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
	}
}

play.astralbeam.ai {
	reverse_proxy localhost:4900 {
		header_up X-Forwarded-For {client_ip}
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
	}
}

demo.astralbeam.ai {
	reverse_proxy localhost:3000 {
		header_up X-Forwarded-For {client_ip}
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
	}
}
```

The explicit `acme` issuer defaults to Let's Encrypt. Enabling DNS-01 disables the other validation challenges.

### Validate and activate Caddy

Format and validate using the token file:

```sh
sudo /usr/bin/caddy fmt --overwrite /etc/caddy/Caddyfile
sudo /usr/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile --envfile /etc/caddy/cloudflare.env
```

Only after validation succeeds, restart to load the new binary and environment and enable the service at boot:

```sh
sudo systemctl daemon-reload
sudo systemctl enable caddy
sudo systemctl restart caddy
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy --since "5 minutes ago" --no-pager
```

## Upgrading applications

Have reviewed database and configuration backups and the Bun version from [`.bun-version`](../.bun-version) installed at `/root/.bun/bin/bun`. Keep `DATABASE_URL` in the literal `Environment="DATABASE_URL=..."` line in `/etc/systemd/system/astralbeam-platform.service`, using `%%` for literal percent signs. Drop-ins and `EnvironmentFile=` settings are not read. Do not run contributor `scripts/setup.sh` on this server.

Run [upgrade.sh](upgrade.sh) as root:

```sh
cd /root/work/astralbeam
./internal/upgrade.sh
```

To select a specific platform release, use `./internal/upgrade.sh vX.Y.Z` with the desired tag. Omit the tag for the latest release.

## Verify HTTP and HTTPS

Run these requests from your computer. The apex should return 200, and demo and play may return their expected authentication responses:

```sh
curl --head --connect-timeout 10 https://astralbeam.ai/
curl --head --connect-timeout 10 https://astralbeam.ai/api/openapi.json
curl --head --connect-timeout 10 https://demo.astralbeam.ai/
curl --head --connect-timeout 10 https://play.astralbeam.ai/
curl --head --connect-timeout 10 'https://www.astralbeam.ai/docs?source=verify'
curl --head --connect-timeout 10 'https://app.astralbeam.ai/docs?source=verify'
```

The last two requests should return permanent redirects to the same path and query on `https://astralbeam.ai`. Existing certificates may delay issuance until renewal, so a successful restart alone does not prove DNS-01 works. Confirm successful DNS-01 issuance in the Caddy logs.

DNS-01 needs no inbound validation ports. Closing origin TCP port 80 is a separate firewall change. Ensure Cloudflare's Always Use HTTPS is on, then confirm that all three hosts still redirect HTTP to HTTPS after port 80 closes:

```sh
curl --head --connect-timeout 10 http://astralbeam.ai/
curl --head --connect-timeout 10 http://demo.astralbeam.ai/
curl --head --connect-timeout 10 http://play.astralbeam.ai/
```

Successful redirects before port 80 closes may come from Caddy, so they do not establish that Cloudflare will redirect without it.

Check the public HSTS header and TLS 1.2 support:

```sh
curl --head --connect-timeout 10 https://astralbeam.ai/
curl --head --connect-timeout 10 --tlsv1.2 --tls-max 1.2 https://astralbeam.ai/
```

When disabling HSTS, set its max age to zero while HTTPS remains available. Keep HTTPS working until previously issued policies expire, including older policies cached by browsers that have not received the replacement header.

## Optional image and preview delivery through Caddy

Default delivery keeps profile images on direct S3 redirects and chat files on application delivery. For our production deployment, Caddy can stream avatars, logos and chat previews from private storage while AstralBeam only authorizes requests and creates one-minute presigned URLs. Browser URLs remain stable, with `private, no-cache` and S3 ETags for revalidation. Original chat downloads keep their existing application byte verification and `private, no-store`.

1. Use an HTTPS S3 endpoint reachable from Caddy. Keep Platform's port private to the reverse proxy, such as a loopback listener. Leave **Asset delivery** on **Default delivery** until the proxy is ready.
2. Add the following matcher and handler inside the existing `astralbeam.ai` site, alongside its normal `reverse_proxy localhost:3100`. This uses standard Caddy features, validated with Caddy 2.11.7, without another module, shared credential or filesystem mount:

```caddyfile
@proxied_assets path /api/files/organizations/*/avatars/* /api/files/organizations/*/logos/* /api/v1/chat/files /api/v1/chat/files/ /api/chat/files /api/chat/files/
handle @proxied_assets {
	header ?Cache-Control "private, no-store"
	reverse_proxy localhost:3100 {
		header_up X-Asset-Proxy 1
		header_down -X-Asset-*
		header_down -X-Accel-*
		@asset {
			status 200
			header X-Accel-Redirect *
		}
		handle_response @asset {
			copy_response_headers {
				exclude Cache-Control Content-Length Content-Type Content-Disposition Date X-Asset-Upstream X-Asset-Host X-Accel-Redirect
			}
			rewrite {rp.header.X-Accel-Redirect}
			reverse_proxy {rp.header.X-Asset-Upstream} {
				transport http {
					tls
				}
				header_up -*
				header_up Host {rp.header.X-Asset-Host}
				header_up If-None-Match {http.request.header.If-None-Match}
				header_up If-Modified-Since {http.request.header.If-Modified-Since}
				@success status 200 304
				handle_response @success {
					header >Cache-Control "private, no-cache"
					copy_response
				}
				handle_response {
					respond "" {rp.status_code}
				}
			}
		}
	}
}
```

3. Follow [Validate and activate Caddy](#validate-and-activate-caddy). Keep debug logging disabled because upstream URLs contain temporary credentials.
4. At `/configure`, select **Reverse proxy** under **Asset delivery**, then save. Restart other Platform replicas because configuration is cached per process. Each serving Caddy needs the same handler.

The handler preserves application security and CORS headers. It intercepts the application's `X-Accel-Redirect` response and fetches the internally presigned path from S3. It forwards only the storage host and browser validators, excluding application cookies and authorization headers. The `X-Asset-Proxy` request header detects a missing proxy handler, and does not authorize file access. Every request reaches application authorization before S3 can return `304`. Storage error bodies and internal handoff headers are not sent to the browser. This follows <a href="https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#examples" target="_blank" rel="noopener noreferrer">Caddy's response-interception pattern</a> with an S3 upstream.

Verify in browser developer tools that avatars, logos and chat previews return `200` at their application URLs, then `304` on reload with unchanged ETags. A signed-out request must return `401`, even with `If-None-Match`. Chat previews must preserve CORS and sandbox headers and return `204` when unavailable. Original downloads must still return verified bytes with `no-store`. A missing proxy header or an HTTP storage endpoint returns `503` in proxy mode. To roll back, select **Default delivery** and restart other Platform replicas. The handler can remain installed and will pass through the existing S3 redirects.

`no-cache` permits private browser storage while requiring revalidation before reuse. It does not guarantee deletion of cached bytes after a fixed period. Avatar, logo and cached-preview bytes stream through Caddy. Original download verification and preview generation still read source bytes in AstralBeam.

## Caddy maintenance

### Rotate the Cloudflare token

Create a replacement with the same zone permissions and update the root-only file:

```sh
sudo nano /etc/caddy/cloudflare.env
```

Keep the replacement token valid for future renewals. Revoke the old token after validating and restarting Caddy with the replacement. A configuration reload alone does not refresh the running service's environment.

### Upgrade the custom Caddy binary

APT maintains the service files but does not upgrade the custom binary. Back it up, upgrade it, and confirm the DNS module remains available:

```sh
sudo cp -a /usr/bin/caddy.custom "/usr/bin/caddy.custom.backup-$(date +%Y%m%d-%H%M%S)"
sudo /usr/bin/caddy.custom upgrade
/usr/bin/caddy version
/usr/bin/caddy list-modules
```

Continue only if `dns.providers.cloudflare` appears.

### Validate and activate maintenance changes

After changing the token or binary, validate the current configuration:

```sh
sudo /usr/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile --envfile /etc/caddy/cloudflare.env
```

Only after validation succeeds, restart Caddy and check the service:

```sh
sudo systemctl restart caddy
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy --since "5 minutes ago" --no-pager
```
