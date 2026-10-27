# Security

Protect the deployment's encryption key, database, private storage, and operator endpoint. This guide covers self-hosting controls. For embedded chat and host tools, see the [SDK security model](/docs/sdk/security).

## Encryption at rest

Deployment settings, model and sandbox credentials, and MCP authorization data are encrypted in PostgreSQL.

Encryption uses AES-256-GCM with a key derived from `DATABASE_ENCRYPTION_KEY`. Values are bound to their stored identity and keyring entry. Invalid ciphertext and unknown keys are rejected.

Better Auth separately encrypts the OAuth tokens it retains. Everything else, including API key digests, is stored as it reads, so treat the whole database as sensitive and protect it with PostgreSQL's own transport and storage controls.

## Rotating the encryption key

`DATABASE_ENCRYPTION_KEY` is a comma-separated keyring, not a single value. The first entry is active: it encrypts every new write and it is the operator sign-in credential. Later entries only decrypt.

1. Restart every replica with the new entry first and the old one behind it, as `DATABASE_ENCRYPTION_KEY=new,old`.
2. Open `/configure`. It confirms "Encryption key rotation in progress" and shows how many fallback entries are available.
3. Re-save each value that still uses the old entry. A field encrypted under a fallback key says `Encrypted with a fallback key; replace and save it to use the active key.`. Non-secret fields move across on a plain save, while a secret must be revealed or replaced first, because the page never holds a copy of a stored secret.
4. Save each model provider under **Models**. Under **Sandboxes**, test and save a replacement credential: saving an unchanged credential does not rewrite it. MCP server definitions with stored OAuth clients must be recreated, and users must reconnect their private connections. The model catalog re-encrypts on its next successful refresh. These values do not report fallback keys on `/configure`.
5. Finish or restart in-flight MCP authorizations and verify that every retained encrypted value has been replaced or rewritten with the active key before removing the old entry. Then restart all replicas with only the new entry. There is no automatic whole-database re-encryption command.

Changing the active entry invalidates operator sessions. Sign in again with the new value.

**NOTE**: An empty fallback warning list on `/configure` does not prove rotation is complete. Removing a key still protecting any stored value makes that value unreadable.

Each entry must be 32 to 1024 characters, unique after trimming, and free of commas. Hashing does not strengthen a weak passphrase, so generate each entry with `openssl rand -base64 32` and keep it in your secret manager.

## Unreadable values

A missing key or damaged ciphertext makes a stored setting unreadable. It is treated as unset. The log identifies the affected key, and `/configure` asks for a replacement.

Enter a replacement and save. You do not need to recover or reveal the old value first.

**TIP**: If the value was a credential held elsewhere, rotate it at that provider too, since you can no longer prove what was stored.

## Operator access

Sign in to `/configure` with the first entry of `DATABASE_ENCRYPTION_KEY`. Dashboard accounts, database credentials, and fallback entries cannot access it.

- Sessions last 15 minutes and are carried in an `HttpOnly`, `SameSite=Strict` cookie that is `Secure` in production, unless `ALLOW_INSECURE=true`. **Sign out** and **Go to app** both end the session immediately.
- Sign-in is throttled to 5 attempts per minute for the whole deployment. Over the limit, the response carries `Retry-After` and reports `Too many sign-in attempts; try again in <n> seconds.`. A wrong value reports `Invalid encryption key`.
- Page responses are `Cache-Control: no-store` with `Referrer-Policy: no-referrer`.

Restrict `/configure` at the ingress with an IP allowlist, VPN, or identity-aware proxy, and add rate limiting during first setup. Its credential can decrypt the deployment's stored secrets.

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

`/configure` honors `X-Forwarded-Host` and `X-Forwarded-Proto` only from a loopback peer:

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

Chat tokens are signed with the API key secret's digest and verified against the stored digest. Read access to that digest therefore grants signing access. Treat a database dump or replica as capable of minting chat tokens for any organization.

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

See [Versions and support](./overview.md#versions-and-support) before reporting.
