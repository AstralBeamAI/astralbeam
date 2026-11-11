# Configuration

Open `/configure` to set up authentication, email, and file storage. Most installations can keep the other defaults. Standalone bootstrap prepares the database and encryption key. See [Deploy](./deploy.md#standalone-binary).

## Complete the initial configuration

1. Sign in with the active `DATABASE_ENCRYPTION_KEY`.
2. Set the public base URL for public hosting and an optional support address under **General**.
3. Configure **Authentication**, **Models**, **Email Delivery**, and **File storage**. Test email connectivity and storage before saving.
4. Choose **Save**, resolve any field errors, and complete the owner invitation.
5. Choose **Go to app**. New organizations can chat right away through the [default OpenAI key](#models).

Add social sign-in or telemetry export when you need them.

## Where settings live

Settings are encrypted in PostgreSQL and edited at `/configure`. Environment variables override stored values, which override built-in defaults.

Fields supplied by an environment variable show an **Environment** badge and are read only. Reveal a stored secret before editing or clearing it. Sign in with the active encryption key. See [Operator access](./security.md#operator-access).

## General

| Setting | Required | Default | Notes |
| --- | --- | --- | --- |
| `app_base_url` | Yes | `http://localhost:<port>` | Public origin the deployment is served from. Used for OAuth callbacks and links in email |
| `trust_proxy` | No | `false` | Use an explicit proxy IP/CIDR allowlist when enabling forwarded client IPs. An empty list trusts all proxies. See [Reverse proxy trust](./security.md#reverse-proxy-trust) |
| `client_ip_headers` | No | `x-forwarded-for` | Ordered client-IP headers, used only when proxy trust is enabled |
| `privacy_policy_url` | No | none | Public HTTP or HTTPS link shown during sign-in and sign-up |
| `terms_of_service_url` | No | none | Public HTTP or HTTPS link shown during sign-in and sign-up |
| `support_email_address` | No | none | Copied on welcome and support request emails, so replies and **Contact Support** requests reach your team. Unset hides **Contact Support** |
| `website_url` | No | none | Origin of a separately hosted website to serve under this deployment's origin |
| `allow_private_model_endpoints` | No | `false` | `true` lets model provider connections use HTTP and private network hosts |

Use your public HTTPS origin as the base URL, with no path, query, fragment, or credentials. Local HTTP evaluation requires `ALLOW_INSECURE=true` to access `/configure` in production builds.

When `website_url` is set, signed-out visitors to `/` and everyone at `/home` see the website's home page, and the website's own pages such as `/terms` and `/privacy` are served under the deployment's origin. Signed-in visitors to `/` still go to their organization.

Setting either legal URL adds an acceptance step to sign-up.

## Authentication

| Setting | Required | Default | Notes |
| --- | --- | --- | --- |
| `better_auth_secret` | Yes | none | At least 32 characters. Bootstrap supplies an independent random secret. Generated on the first save when left unset |
| `turnstile_site_key` | Yes | none | Cloudflare Turnstile public site key, sent to browsers |
| `turnstile_secret_key` | Yes | none | Cloudflare Turnstile server-only secret |
| `google_client_id` | No | none | Set with `google_client_secret` or not at all |
| `google_client_secret` | No | none | Paired with `google_client_id` |
| `github_client_id` | No | none | Set with `github_client_secret` or not at all |
| `github_client_secret` | No | none | Paired with `github_client_id` |

The authentication secret is generated during setup. Rotating it signs out dashboard users as replicas refresh configuration, within five seconds.

Both Turnstile keys are mandatory, so setup cannot complete without them. Bootstrap supplies test keys for initial testing. For public hosting, create a widget in the Cloudflare dashboard, restrict it to the deployment's hostnames, and replace both keys. Cloudflare publishes [test keys for local and automated use](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

Social sign-in is optional. Configure both the client ID and secret to enable a provider, and register its callback URL:

```text
<app_base_url>/api/auth/callback/google
<app_base_url>/api/auth/callback/github
```

## Email delivery

Choose one provider. Set `email_from_address` to a verified sender such as `Support <support@example.com>`. It is required for Resend and SES. SMTP otherwise uses `no-reply@<app hostname>`.

<!-- ::start:tabs -->

### SMTP

Set `email_provider` to `smtp` (the default).

| Setting | Default | Notes |
| --- | --- | --- |
| `smtp_host` | `127.0.0.1` | Mail server hostname |
| `smtp_port` | `1025` | Set your provider's port, usually 587 or 465 |
| `smtp_security` | `none` | `starttls` requires STARTTLS, `tls` uses TLS from connection start, `auto` permits unencrypted fallback, `none` disables TLS |
| `smtp_username`, `smtp_password` | none | Supply both, or neither for an unauthenticated relay |

The defaults target a local mail sink. Configure the host, port, and TLS mode for production.

For SES over SMTP, use [regional SMTP credentials](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html), rather than AWS access keys.

### Resend

Set `email_provider` to `resend`.

| Setting              | Required | Notes                       |
| -------------------- | -------- | --------------------------- |
| `resend_api_key`     | Yes      | API key with sending access |
| `email_from_address` | Yes      | Verified sender address     |

### Amazon SES

Set `email_provider` to `ses`.

| Setting | Required | Notes |
| --- | --- | --- |
| `aws_region` | Yes | Identities and sandbox status are per Region |
| `email_from_address` | Yes | Verified sender address |
| `aws_access_key_id`, `aws_secret_access_key` | No | Supply both for static credentials, or neither to use the deployment's credential chain, such as an instance role |

<!-- ::end:tabs -->

Use **Test connection** before saving. It checks the current form without sending email. SES testing also requires `ses:GetAccount` permission and account sending enabled. Leave credentials for unused providers unset.

## File storage

Keep **File System** for a single-host installation, or choose **S3-compatible** for replicas on different hosts. New installations default to File System. Existing S3 installations keep their provider. Both store attachments, avatars, logos, and published sandbox files privately.

For File System, choose a persistent **Storage directory** writable by the service account and outside the web server's public root. Every worker and maintenance runner on the host must use the same directory. Containers use `/var/lib/astralbeam/storage`, and Compose supplies its persistent volume. Monitor free space and use ingress connection limits for slow clients, since downloads hold a complete file in memory.

Without an explicit directory, defaults are `~/.local/share/astralbeam/storage` on Linux, `~/Library/Application Support/AstralBeam/storage` on macOS, and `%LOCALAPPDATA%\AstralBeam\storage` on Windows. `ASTRALBEAM_DATA_DIR` changes the base directory, with files under `storage/`. On Unix, an absolute `XDG_DATA_HOME` also overrides the default data location.

For S3-compatible storage, configure:

| Setting | Required | Default | Notes |
| --- | --- | --- | --- |
| `s3_endpoint` | Yes | none | S3 API URL, including any path prefix such as `/storage/v1/s3`. HTTPS is required except for loopback and local `rustfs`/`minio` hosts |
| `s3_region` | Yes | none | Bucket region, or `auto` for Cloudflare R2 |
| `s3_bucket` | Yes | none | Private bucket dedicated to this deployment |
| `s3_access_key_id` | Yes | none | Storage access-key ID, independent of SES credentials |
| `s3_secret_access_key` | Yes | none | Storage secret access key |
| `s3_path_style` | Yes | `false` | Set to `true` for path-style backends such as MinIO |

1. Create a private bucket and credentials with object read, write, and delete access. AWS S3 also requires [bucket-level `s3:ListBucket` permission](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html) to distinguish missing files from denied reads. Versioned buckets need [`s3:DeleteObjectVersion`](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html) so connection tests permanently remove their temporary object version.
2. Enter the bucket settings in **File storage** at `/configure`.
3. Press **Test storage** to upload, inspect, download, verify, delete, and confirm the temporary object is missing using the current values. Reveal stored credentials first if you have not entered new ones.
4. Save the configuration.

The test checks object operations. Configure bucket privacy and browser CORS separately at the provider.

For versioned buckets, configure your provider's lifecycle rules to expire temporary objects, noncurrent versions, and expired delete markers under `connection-tests/`. This cleans up interrupted tests and upload retries whose responses were lost. See [S3 expiration behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html).

**Changing the storage destination does not move existing files.** Stop writers and maintenance runners, copy files with their relative paths or object keys unchanged, verify sizes and checksums, save the new settings, and restart every instance. Keep the old storage until needed files are verified. Export RustFS through its S3 API rather than copying its internal data directory.

For direct S3 downloads, the endpoint must be reachable from users' browsers. Allow GET from your embedding origins in the bucket's CORS policy, and expose `Content-Disposition` if your application reads that header. Keep the bucket private. Signed download URLs are bearer links that remain usable until their one-minute expiry, even if access is revoked. Do not persist them. File System downloads stay proxied through AstralBeam. HTTP clients can omit `delivery=direct` to keep proxied S3 responses.

Conversation files survive sandbox shutdown and remain until deletion. Retired files are removed asynchronously. Unattached uploads or direct SQL deletions can leave unreachable objects.

To rotate credentials, create a key with the same bucket permissions, enter it at `/configure`, test storage, and save. After the five-second configuration cache expires, verify uploads and downloads on every replica before revoking the old key. Keep destination fields unchanged.

Follow [Backups and restore](./operations.md#backups-and-restore) for coordinated backups. A database-only restore can reference missing objects. Bucket versioning can retain old bytes under a separate [retention policy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html).

If storage fails, repair its settings and run the connection test. Pending file deletions retry after recovery.

## Models

| Setting | Required | Default | Notes |
| --- | --- | --- | --- |
| `default_openai_api_key` | Yes | none | OpenAI API key copied into each new organization's **OpenAI** connection |

Every new organization starts ready to chat. It gets an **OpenAI** connection that uses this key, GPT-6 Luna assigned to its starter agent, and an enabled **Monthly spend** limit of $10 per calendar month in UTC, shared by the whole organization. Owners can replace the key, change models, or edit the limit in their dashboard. Changing this setting affects only organizations created afterward.

**NOTE**: Organizations spend against your OpenAI account until their owners replace the key, and owners can raise or disable the starter limit. On a deployment open to sign-ups, also set [usage limits](https://platform.openai.com/settings/organization/limits) in your OpenAI organization.

Owners add and test other providers under [Models](/docs/dashboard/models). Each organization, including the one running Astro, manages its own credentials after it is created.

Endpoints require public HTTPS and cannot redirect by default. Enable `allow_private_model_endpoints` only for trusted organizations that need a private gateway such as Ollama. Its endpoint receives provider keys, conversations, and tool calls, so keep private access disabled on deployments shared by untrusted organizations.

## Sandbox providers

Each organization manages encrypted sandbox credentials under [Sandboxes](/docs/dashboard/sandboxes). Saving requires a passing connection test. Agents can run without a sandbox.

## Applying changes

Choose **Save** to apply changes together. Resolve inline errors before saving again. Required fields cannot be empty. To clear an optional setting, delete its contents and save. Reveal a stored secret before replacing or clearing it.

A save takes effect immediately on the process that handled it. Other replicas refresh their snapshot on the next read after its five-second cache expires. Observability exporters are created once at startup, so restart every server instance after changing observability settings. Environment changes also require a restart.

The app remains unavailable while required settings are missing. **Go to app** appears once configuration and owner onboarding are complete.

## Environment overrides

Use the uppercase setting name for an environment override, such as `APP_BASE_URL` or `SMTP_PORT`:

- It takes precedence over the stored value.
- Its field at `/configure` becomes read only, and attempting to save it returns `This value is provided by <VARIABLE>`.
- It is read once at startup, so changing or removing it requires a restart.

Use ordinary unquoted values. Invalid overrides fail at startup with the variable name and reason.

**NOTE**: An empty variable counts as unset, so the stored value applies again.

## Observability

Tracing and optional log shipping use OpenTelemetry's OTLP/HTTP protobuf protocol with the [standard SDK environment variable names](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/) and [OTLP base endpoint semantics](https://opentelemetry.io/docs/specs/otel/protocol/exporter/#endpoint-urls-for-otlphttp). Configure a compatible receiver in **Observability** at `/configure`, then restart every server instance, including the one that saved the settings.

| Setting | Environment variable | Default | Notes |
| --- | --- | --- | --- |
| `otel_exporter_otlp_endpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | none | OTLP base URL. Appends `/v1/traces` for traces and `/v1/logs` for logs |
| `otel_exporter_otlp_headers` | `OTEL_EXPORTER_OTLP_HEADERS` | none | Comma-separated `key=value` headers |
| `otel_exporter_otlp_traces_headers` | `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | none | Trace-specific headers. Percent-encode commas in values |
| `otel_logs_exporter` | `OTEL_LOGS_EXPORTER` | `none` | Set to `otlp` to also ship server logs. Console JSON continues |
| `otel_sdk_disabled` | `OTEL_SDK_DISABLED` | `false` | Set to `true` to disable export without clearing the connection |
| `otel_resource_attributes` | `OTEL_RESOURCE_ATTRIBUTES` | none | Comma-separated labels attached to exported spans and logs. Do not include secrets |

Export stays disabled until an endpoint is configured. Log shipping also requires `otel_logs_exporter=otlp`. Batching, retries, timeouts, and shutdown flushing use the native exporters' defaults. Delivery is best effort, without a persistent queue.

Trace-specific headers override matching generic headers. For a local receiver:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"
OTEL_LOGS_EXPORTER="otlp"
OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=development,service.instance.id=worktree-1"
```

For a hosted receiver, copy its OTLP base endpoint and authentication headers from its official setup instructions. Remove a trailing `/v1/traces` from the endpoint, since AstralBeam appends the signal path. Save, restart every instance, make a request, and check the receiver after allowing time for ingestion.

Provider setup: [PostHog](https://posthog.com/docs/distributed-tracing/installation/nodejs), [New Relic](https://docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/), [Datadog](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/traces/), [Sentry](https://docs.sentry.io/concepts/otlp/direct/traces/), [Honeycomb](https://docs.honeycomb.io/send-data/opentelemetry/), and [Grafana Cloud](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/).

**Traces include prompts, responses, tool arguments, and results.** Credential patterns are redacted, but conversation content can still be sensitive. Send telemetry only to a receiver approved for that data. SQL text and credential-bearing URL fields are excluded.

Exported logs include request metadata, errors, and trace/span IDs. Log export uses generic OTLP headers rather than traces-specific headers. Early startup logs remain console-only. Receiver issue grouping varies, and Sentry's direct OTLP ingestion does not replace its native exception capture.

Use `deployment.environment.name` and `service.instance.id` resource attributes to distinguish environments and replicas. An environment override replaces stored labels. Browser correlation uses `user.id` and `session.id` on spans and shipped logs.

### PostHog errors and AI observability

The US or EU PostHog OTLP receiver also enables backend errors and AI observability using its configured bearer token. Switching receivers or disabling telemetry disables backend PostHog capture. Hosted browser analytics remain independent.

### Source maps for custom builds

Platform and website production builds generate hidden source maps and deterministic debug IDs without upload credentials. IDs include the Git revision and source positions, so older deployments retain their matching maps and release. Set `SOURCE_VERSION` to the commit SHA when building without Git metadata, including custom Docker builds with `--build-arg SOURCE_VERSION=<sha>`. Each build collects its matching JavaScript and maps under `.output/sourcemaps`, outside served assets and compiled binaries. Use that directory with any compatible uploader.

For PostHog, run `bun run sourcemaps:posthog --directory .output/sourcemaps` from the project directory after building. The command binds maps to the CLI's Git release. When uploading outside the original checkout, pass `--release-version <sha>` matching `SOURCE_VERSION`. Set `POSTHOG_CLI_API_KEY` to a personal API key with error tracking write and organization read scopes, and `POSTHOG_CLI_PROJECT_ID` to the project ID. `POSTHOG_CLI_HOST` optionally selects another region or instance. Keep these credentials in the CI upload step. Uploads leave the generated files unchanged, so the same artifact can be sent to multiple destinations.

Upload source maps from the exact build you deploy. Different bundles need their own matching maps.
