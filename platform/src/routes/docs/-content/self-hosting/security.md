# Security

Before public hosting, enable HTTPS, restrict access to `/configure`, replace test credentials, and back up the encryption key separately from the database. For embedded chat and host tools, see the [SDK security model](/docs/sdk/security).

## Encryption at rest

Deployment settings, model and sandbox credentials, and MCP authorization data use AES-256-GCM encryption derived from `DATABASE_ENCRYPTION_KEY`. Invalid ciphertext and unknown keys are rejected. Better Auth separately encrypts retained OAuth tokens.

This does not encrypt the whole database. Protect database connections and storage, and treat backups as sensitive. API key digests can be used to sign tokens, as described under [Credentials and tokens](#credentials-and-tokens).

## Rotating the encryption key

`DATABASE_ENCRYPTION_KEY` accepts a comma-separated keyring. The first entry encrypts new writes, provides cluster peer authentication, and grants operator access. Later entries decrypt older values and verify peer credentials. Keep both keys during rotation so all replicas can continue communicating.

1. First restart every replica with `DATABASE_ENCRYPTION_KEY=old,new` to add the new key without changing the active entry. Once that rollout completes, restart them with `DATABASE_ENCRYPTION_KEY=new,old`.
2. Open `/configure`. It confirms "Encryption key rotation in progress" and shows how many fallback entries are available.
3. Re-save each value that still uses the old entry. A field encrypted under a fallback key says `Encrypted with a fallback key; replace and save it to use the active key.`. Non-secret fields move across on a plain save, while a secret must be revealed or replaced first, because the page never holds a copy of a stored secret.
4. Save each model provider under **Models**. Under **Sandboxes**, test and save a replacement credential: saving an unchanged credential does not rewrite it. MCP server definitions with stored OAuth clients must be recreated, and users must reconnect their private connections. The model catalog re-encrypts on its next successful refresh. These values do not report fallback keys on `/configure`.
5. Finish or restart in-flight MCP authorizations and verify that every retained encrypted value has been replaced or rewritten with the active key before removing the old entry. Then restart all replicas with only the new entry. There is no automatic whole-database re-encryption command.

Changing the active entry invalidates operator sessions. Sign in again with the new value.

**NOTE**: An empty fallback warning list on `/configure` does not prove rotation is complete. Removing a key still protecting any stored value makes that value unreadable.

Each entry must be 32 to 1024 characters, unique after trimming, and free of commas. Hashing does not strengthen a weak passphrase, so generate each entry with `openssl rand -base64 32` and keep it in your secret manager.

## Unreadable values

A missing key or damaged ciphertext makes a stored setting unreadable. The log identifies the setting, and `/configure` asks for a replacement. Enter a replacement and save without revealing the old value.

If it was a provider credential, rotate it at the provider too.

## Operator access

Sign in to `/configure` with the first entry of `DATABASE_ENCRYPTION_KEY`. Dashboard accounts, database credentials, and fallback entries cannot access it.

- Sessions last 15 minutes and are carried in an `HttpOnly`, `SameSite=Strict` cookie that is `Secure` in production, unless `ALLOW_INSECURE=true`. **Sign out** and **Go to app** both end the session immediately.
- Sign-in allows 5 attempts per minute for the whole deployment. A throttled response includes `Retry-After`.
- Page responses are `Cache-Control: no-store` with `Referrer-Policy: no-referrer`.

Restrict `/configure` at the ingress with an IP allowlist, VPN, or identity-aware proxy, and add rate limiting during first setup. Its credential can decrypt the deployment's stored secrets.

## HTTPS and response headers

Use HTTPS for public hosting and keep `ALLOW_INSECURE` unset or `false`. Bootstrap enables it for local testing, so replace that default before going public. Production `/configure` redirects HTTP reads to HTTPS and rejects HTTP writes without this opt-in. Changes must also come from the same origin.

Responses use these security defaults. Individual routes may strengthen them, as `/configure` does with `Referrer-Policy: no-referrer`:

| Header | Value |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `frame-ancestors 'none'`, appended so a route's own policy still applies |
| `Permissions-Policy` | `camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`, on secure requests only |

Framing is denied everywhere, including the API paths, because the embedded widget uses cross-origin fetch rather than a frame and needs no framing exemption. HSTS is sent when the request arrived over HTTPS or the proxy said it did, so it never appears on a plain-HTTP local run.

## Reverse proxy trust

For a proxy on the same host, loopback (`127.0.0.1` and `::1`) is already trusted for forwarded host/protocol. To use forwarded client IPs, enable **Trust Proxy** and enter the proxy's actual IPs/CIDRs. For remote proxies, set `TRUST_PROXY=<IPs/CIDRs>` in the service environment before first start so HTTPS operator access works even when database settings are unavailable.

**Trust Proxy** defaults to disabled, which ignores client IP headers. Enabling it with an empty allowlist, or setting `TRUST_PROXY=true`, trusts every peer. Use an explicit allowlist and prevent clients from bypassing the proxy.

- Allow the proxy's actual socket-peer address. Same-host loopback connections are already trusted for host/protocol. A host-published container port may present a different peer address.
- Have the proxy overwrite `X-Forwarded-Host` and `X-Forwarded-Proto` on every request instead of passing a client value through.
- Prevent other clients from reaching the application port directly. With `TRUST_PROXY=true` or an empty list while **Trust Proxy** is enabled, any caller can supply trusted headers, so origin access restrictions are essential.

The proxy must also overwrite **Client IP Headers**, which default to `x-forwarded-for`. Use `CLIENT_IP_HEADERS` for a different ordered list. When trust is disabled or the peer is untrusted, authentication uses the socket address. [Deploy](./deploy.md#https-reverse-proxy) includes a same-host Nginx example.

With an IP/CIDR allowlist, authentication resolves forwarded IP chains from right to left through trusted hops. With unrestricted trust, it uses the leftmost client address and validates it through Better Auth.

## Bot protection

Configure both Cloudflare Turnstile keys for sign-in, sign-up, and password reset. The site key is public, and the secret key stays on the server. See [Authentication settings](./configuration.md#authentication).

Create a separate widget per deployment, restrict it to the hostnames that serve that deployment, and keep production widgets from allowing localhost.

Bootstrap supplies Cloudflare's test keys for evaluation. Replace both keys before public hosting and set `SKIP_EMAIL_VERIFICATION=false` so password sign-ups verify their address.

## Credentials and tokens

An organization API key is `key_<organizationId>_<id>_abo_<secret>`. Only a SHA-256 digest of the secret is stored, so the full value is available when the key is created and cannot be recovered afterwards. A lost key is replaced, not looked up.

Chat tokens are signed with the API key secret's digest and verified against the stored digest. Read access to that digest therefore grants signing access. Treat a database dump or replica as capable of minting chat tokens for any organization.

Deleting or expiring an API key stops tokens already signed with it. Mint tokens only on your server and keep the API key out of client bundles. For token format and lifetime, see [SDK authentication](/docs/sdk/authentication).

## Reporting a vulnerability

Report privately through [GitHub security advisories](https://github.com/AstralBeamAI/astralbeam/security/advisories/new). Do not open a public issue or pull request for a suspected vulnerability. Say whether you reproduced it on a self-hosted deployment or on AstralBeam Cloud, and include the version, tag, or commit you tested.

See [Versions and support](./overview.md#versions-and-support) before reporting.
