# Security

What a self-hosted deployment protects on its own, and what you have to do. The embedded chat boundary is documented separately in the [SDK security model](/docs/sdk/security).

## Encryption at rest

Two columns hold ciphertext rather than plaintext.

| Column                         | Contents                                             |
| ------------------------------ | ---------------------------------------------------- |
| `config.value`                 | Every deployment setting stored through `/configure` |
| `sandbox_provider.credentials` | Each organization's sandbox provider credentials     |

Both are sealed as compact JWE with AES-256-GCM, using a key derived from an entry of `DATABASE_ENCRYPTION_KEY`. The header carries a non-secret key identifier so the right keyring entry can be selected during a rotation, and the encrypted payload embeds the row's own identity, which is compared with the row after decoding. Moving ciphertext from one row to another therefore fails instead of decrypting under the wrong identity, and a malformed envelope or an unknown key identifier never falls back to unverified data.

Better Auth separately encrypts the OAuth tokens it retains. Everything else, including API key digests, is stored as it reads, so treat the whole database as sensitive and protect it with PostgreSQL's own transport and storage controls.

## Rotating the encryption key

`DATABASE_ENCRYPTION_KEY` is a comma-separated keyring, not a single value. The first entry is active: it encrypts every new write and it is the operator sign-in credential. Later entries only decrypt.

1. Restart every replica with the new entry first and the old one behind it: `DATABASE_ENCRYPTION_KEY=new,old`.
2. Open `/configure`. It confirms "Encryption key rotation in progress" and shows how many fallback entries are available.
3. Re-save each value that still uses the old entry. A field encrypted under a fallback key says `Encrypted with a fallback key; replace and save it to use the active key.`. Non-secret fields move across on a plain save. A secret must be revealed or replaced first, because the page never holds a copy of a stored secret.
4. Once nothing reports a fallback key, restart again with only the new entry.

Rotating the active entry has two immediate effects. Every operator session is invalidated, because session signing derives from the active entry, and sign-in now requires the new value. Removing an entry that still protects a stored value makes that value unreadable, so complete step 3 before step 4.

Each entry must be 32 to 1024 characters, unique after trimming, and free of commas. Hashing does not strengthen a weak passphrase, so generate each entry with `openssl rand -base64 32` and keep it in your secret manager.

## Unreadable values

A stored value that cannot be decrypted, because its key is gone or its envelope is damaged, is reported as such rather than guessed at. The deployment behaves as if the setting were unset, the log records `Ignoring invalid stored config value for '<key>'`, and the field at `/configure` says `The stored value cannot be read; enter and save a replacement.`.

You do not need to recover a value to replace it. Type a new one over the field and save. This blind replacement is deliberate, so a lost key never forces you to reveal or reconstruct the old secret. If the value was a credential held elsewhere, rotate it at the provider too, since you can no longer prove what was stored.

## Operator access

Operator sign-in at `/configure` compares the submitted value against the first entry of `DATABASE_ENCRYPTION_KEY`, using a constant-time comparison. Dashboard accounts and database credentials give no access to this page, and neither does a fallback keyring entry.

- Sessions last 15 minutes and are carried in an `HttpOnly`, `SameSite=Strict` cookie that is `Secure` in production. **Sign out** and **Go to app** both end the session immediately.
- Sign-in is throttled to 5 attempts per minute for the whole deployment. Over the limit, the response carries `Retry-After` and reports `Too many sign-in attempts; try again in <n> seconds.`. A wrong value reports `Invalid encryption key`.
- Page responses are `Cache-Control: no-store` with `Referrer-Policy: no-referrer`.

The encryption key grants access to every encrypted value in the database, so this page deserves more than its own throttle. Restrict who can reach `/configure` at the ingress with an IP allowlist, a VPN, or an identity-aware proxy, and add an ingress rate limit for it during first setup.

## HTTPS and response headers

In production, `/configure` requires HTTPS. A `GET` or `HEAD` over plain HTTP is redirected to the HTTPS URL with `307`, and any other method is refused with `400` and `HTTPS is required`. Mutations must also be same origin, which the page checks against `Sec-Fetch-Site` and the `Origin` or `Referer` header, and a cross-origin attempt gets `403`.

Every response, on every route, carries these headers:

| Header                      | Value                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `X-Content-Type-Options`    | `nosniff`                                                                          |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                  |
| `X-Frame-Options`           | `DENY`                                                                             |
| `Content-Security-Policy`   | `frame-ancestors 'none'`, appended so a route's own policy still applies           |
| `Permissions-Policy`        | `camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`, on secure requests only                     |

Framing is denied everywhere, including the API paths. The embedded widget uses cross-origin fetch rather than a frame, so it needs no framing exemption. HSTS is sent when the request arrived over HTTPS or the proxy said it did, so it never appears on a plain-HTTP local run.

## Reverse proxy trust

`X-Forwarded-Host` and `X-Forwarded-Proto` are honored on `/configure` only when the request's own peer is a loopback address. That is the rule the deployment topology has to satisfy:

- Run the reverse proxy on the same host as the application and have it connect over loopback.
- Have the proxy overwrite `X-Forwarded-Host` and `X-Forwarded-Proto` on every request instead of passing a client value through.
- Prevent any other client from reaching the application port directly. A remote caller that reaches it cannot satisfy the HTTPS requirement with a forged header, but it also should not be able to try.

The proxy must own `X-Forwarded-For` too. When a request's peer is not loopback, the application replaces that header with the actual peer address before authentication sees it, so a client cannot spoof the address authentication rate limits are keyed on. See [Deploy](./deploy.md) for a proxy configuration that satisfies all of this.

## Bot protection

The Cloudflare Turnstile site key and secret key are both required settings, listed with the rest in [Configuration](./configuration.md), so no deployment runs without a CAPTCHA. They protect sign-in, sign-up, and password reset. The site key is served to browsers, and the secret key stays server side and is used to validate each token with Cloudflare.

Create a separate widget per deployment, restrict it to the hostnames that serve that deployment, and keep production widgets from allowing localhost. Cloudflare publishes test keys for local and automated use, and those belong nowhere near production.

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
