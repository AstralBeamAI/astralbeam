# Security

A self-hosted deployment keeps its stored secrets under a key you own, and leaves the rest to how you put the application on the network. The embedded chat boundary is covered separately in the [SDK security model](/docs/sdk/security).

## Encryption at rest

Encrypted values include deployment settings and the model catalog in `config.value`, model and sandbox provider credentials, MCP connection credentials, OAuth client details inside `mcp_server.auth_config`, and temporary MCP authorization attempts in `cache_entry`.

These values are sealed as compact JWE with AES-256-GCM using a key derived from `DATABASE_ENCRYPTION_KEY`. A non-secret header identifier selects the keyring entry during rotation. Stored identities are checked after decoding to prevent ciphertext from being reused for another row or authorization attempt. Malformed envelopes and unknown keys never fall back to unverified data.

Better Auth separately encrypts the OAuth tokens it retains. Everything else, including API key digests, is stored as it reads, so treat the whole database as sensitive and protect it with PostgreSQL's own transport and storage controls.

## Rotating the encryption key

`DATABASE_ENCRYPTION_KEY` is a comma-separated keyring, not a single value. The first entry is active: it encrypts every new write and it is the operator sign-in credential. Later entries only decrypt.

1. Restart every replica with the new entry first and the old one behind it, as `DATABASE_ENCRYPTION_KEY=new,old`.
2. Open `/configure`. It confirms "Encryption key rotation in progress" and shows how many fallback entries are available.
3. Re-save each value that still uses the old entry. A field encrypted under a fallback key says `Encrypted with a fallback key; replace and save it to use the active key.`. Non-secret fields move across on a plain save, while a secret must be revealed or replaced first, because the page never holds a copy of a stored secret.
4. Save each model provider under **Models**. Under **Sandboxes**, test and save a replacement credential: saving an unchanged credential does not rewrite it. MCP server definitions with stored OAuth clients must be recreated, and users must reconnect their private connections. The model catalog re-encrypts on its next successful refresh. These values do not report fallback keys on `/configure`.
5. Finish or restart in-flight MCP authorizations and verify that every retained encrypted value has been replaced or rewritten with the active key before removing the old entry. Then restart all replicas with only the new entry. There is no automatic whole-database re-encryption command.

Rotating the active entry has two immediate effects. Every operator session is invalidated, because session signing derives from the active entry, and sign-in now requires the new value.

**NOTE**: An empty fallback warning list on `/configure` does not prove rotation is complete. Removing a key still protecting any stored value makes that value unreadable.

Each entry must be 32 to 1024 characters, unique after trimming, and free of commas. Hashing does not strengthen a weak passphrase, so generate each entry with `openssl rand -base64 32` and keep it in your secret manager.

## Unreadable values

A stored value that cannot be decrypted, because its key is gone or its envelope is damaged, is reported as such rather than guessed at. The deployment behaves as if the setting were unset, the log records `Ignoring invalid stored config value for '<key>'`, and the field at `/configure` says `The stored value cannot be read; enter and save a replacement.`.

You do not need to recover a value to replace it. Type a new one over the field and save. This blind replacement is deliberate, so a lost key never forces you to reveal or reconstruct the old secret.

**TIP**: If the value was a credential held elsewhere, rotate it at that provider too, since you can no longer prove what was stored.

## Operator access

Operator sign-in at `/configure` compares the submitted value against the first entry of `DATABASE_ENCRYPTION_KEY`, using a constant-time comparison. Dashboard accounts and database credentials give no access to this page, and neither does a fallback keyring entry.

- Sessions last 15 minutes and are carried in an `HttpOnly`, `SameSite=Strict` cookie that is `Secure` in production, unless `ALLOW_INSECURE=true`. **Sign out** and **Go to app** both end the session immediately.
- Sign-in is throttled to 5 attempts per minute for the whole deployment. Over the limit, the response carries `Retry-After` and reports `Too many sign-in attempts; try again in <n> seconds.`. A wrong value reports `Invalid encryption key`.
- Page responses are `Cache-Control: no-store` with `Referrer-Policy: no-referrer`.

The encryption key grants access to every encrypted value in the database, so this page deserves more than its own throttle. Restrict who can reach `/configure` at the ingress with an IP allowlist, a VPN, or an identity-aware proxy, and add an ingress rate limit for it during first setup.

## HTTPS and response headers

Production builds require HTTPS on `/configure` unless `ALLOW_INSECURE=true`. Plain HTTP carries credentials unencrypted, so keep this flag unset for TLS deployments. Without the flag, plain-HTTP `GET` or `HEAD` requests redirect to HTTPS with `307`, and other methods are refused with `400` and `HTTPS is required`. Mutations must also be same origin, which the page checks against `Sec-Fetch-Site` and the `Origin` or `Referer` header, and a cross-origin attempt gets `403`.

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

`X-Forwarded-Host` and `X-Forwarded-Proto` are honored on `/configure` only when the request's own peer is a loopback address. That is the rule the deployment topology has to satisfy.

- Connect the reverse proxy over loopback in the application's network namespace. A host-published container port does not satisfy this.
- Have the proxy overwrite `X-Forwarded-Host` and `X-Forwarded-Proto` on every request instead of passing a client value through.
- Prevent any other client from reaching the application port directly. A remote caller cannot satisfy the HTTPS requirement with a forged header, but it should not be able to try either.

The proxy must own `X-Forwarded-For` too. When a request's peer is not loopback, the application replaces that header with the actual peer address before authentication sees it, so a client cannot spoof the address authentication rate limits are keyed on. [Deploy](./deploy.md) has a proxy configuration that satisfies all of this.

## Bot protection

The Cloudflare Turnstile site key and secret key are both required settings, listed with the rest in [Configuration](./configuration.md), so no deployment runs without a CAPTCHA. They protect sign-in, sign-up, and password reset. The site key is served to browsers, and the secret key stays server side and is used to validate each token with Cloudflare.

Create a separate widget per deployment, restrict it to the hostnames that serve that deployment, and keep production widgets from allowing localhost.

**NOTE**: Cloudflare publishes test keys for local and automated use. Those belong nowhere near production.

## Credentials and tokens

An organization API key is `key_<organizationId>_<id>_abo_<secret>`. Only a SHA-256 digest of the secret is stored, so the full value is available when the key is created and cannot be recovered afterwards. A lost key is replaced, not looked up.

Chat tokens are the important nuance. Your server signs them offline with the digest of the key secret, and AstralBeam verifies them against the stored digest, which is what lets chat authenticate without the raw key ever reaching it. The consequence is direct: read access to the stored digest is equivalent to signing access. Treat a database read, a dump, or a replica as capable of minting chat tokens for any organization.

| Property        | Value                                                         |
| --------------- | ------------------------------------------------------------- |
| Algorithm       | HS256 over the API key secret's digest                        |
| Issuer          | The organization's UUID                                       |
| Audience        | `astralbeam`                                                  |
| Lifetime        | 60 to 600 seconds, and a token outside that range is rejected |
| Clock tolerance | 30 seconds either way                                         |

A token is also re-checked against the key row after verification, so disabling or expiring an API key stops tokens already signed with it. Mint tokens only on your server, never in the browser, and keep the API key out of client bundles. The [SDK security model](/docs/sdk/security) covers the browser side.

## Reporting a vulnerability

Report privately through [GitHub security advisories](https://github.com/AstralBeamAI/astralbeam/security/advisories/new). Do not open a public issue or pull request for a suspected vulnerability. Say whether you reproduced it on a self-hosted deployment or on AstralBeam Cloud, and include the version, tag, or commit you tested.

AstralBeam is pre-1.0, and only the latest version is supported, which means the current `main` for self-hosted deployments. Fixes land there and ship in the next release, with no backports to older lines, so upgrade before you report.
