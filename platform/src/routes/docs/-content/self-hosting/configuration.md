# Configuration

Configure the deployment at `/configure`. Bootstrap credentials, the listen port, and private runner addresses are set through the environment. See [Deploy](./deploy.md#3-set-the-bootstrap-environment).

## Complete the initial configuration

1. Sign in with the active `DATABASE_ENCRYPTION_KEY`.
2. Set the public base URL for public hosting and an optional support address under **General**.
3. Configure **Authentication**, **Email Delivery**, and **File storage**. Test email connectivity and storage before saving.
4. Choose **Save**, resolve any field errors, and complete the owner invitation.
5. Choose **Go to app**. Configure organization model providers in the dashboard.

The tables below are the setting reference. Telemetry export and social sign-in are optional.

## Where settings live

Settings are encrypted in PostgreSQL and edited at `/configure`. Environment variables override stored values, which override built-in defaults.

Fields supplied by an environment variable show an **Environment** badge and are read only. Reveal a stored secret before editing or clearing it. Sign in with the active encryption key. See [Operator access](./security.md#operator-access).

## General

| Setting | Required | Default | Notes |
| --- | --- | --- | --- |
| `app_base_url` | Yes | `http://localhost:<port>` | Public origin the deployment is served from. Used for OAuth callbacks and links in email |
| `trust_proxy` | No | `false` | Loopback is always trusted for forwarded host/protocol. Enable Trust Proxy to use Client IP Headers and reveal an optional list of additional proxy IPs/CIDRs. An empty list trusts all proxies. Disabling clears additional proxies and ignores client IP headers. See [Reverse proxy trust](./security.md#reverse-proxy-trust) |
| `client_ip_headers` | No | `x-forwarded-for` | Ordered comma-separated header names. Visible only with Trust Proxy enabled. Disabling trust preserves the saved value |
| `privacy_policy_url` | No | none | Public HTTP or HTTPS link shown during sign-up |
| `terms_of_service_url` | No | none | Public HTTP or HTTPS link shown during sign-up |
| `support_email_address` | No | none | Copied on welcome and support request emails, so replies and **Contact Support** requests reach your team. Unset hides **Contact Support** |
| `website_url` | No | none | Origin of a separately hosted website to serve under this deployment's origin |
| `allow_private_model_endpoints` | No | `false` | `true` lets model provider connections use HTTP and private network hosts |

The base URL must be an HTTP(S) origin without a path, query, fragment, or embedded credentials. HTTP is accepted for loopback hosts (`localhost`, `127.0.0.1`, or `[::1]`) or when `ALLOW_INSECURE=true`. Production HTTP deployments, including localhost, need this environment flag to access `/configure`.

When `website_url` is set, signed-out visitors to `/` and everyone at `/home` see the website's home page, and the website's own pages such as `/terms` and `/privacy` are served under the deployment's origin. Signed-in visitors to `/` still go to their organization.

When either legal URL is configured, sign-up requires the user to accept those terms before the form can be submitted. Leave both unset and no acceptance step appears.

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

Use **Generate** for a new authentication secret or **Rotate** to replace it. Rotation signs out dashboard users as replicas refresh configuration, within five seconds.

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

SMTP prefills are available for Local, Resend, Cloudflare, and SES US East (`us-east-1`). Resend and Cloudflare use an API token as the password. For SES, generate [regional SMTP credentials](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html) in the AWS console. Selecting a prefill clears the previous SMTP credentials.

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

Choose **File System** or **S3-compatible** under **File storage** at `/configure`. New installations default to File System. Existing S3 settings keep using S3 unless the provider is explicitly overridden. Set `STORAGE_PROVIDER=filesystem` or `STORAGE_PROVIDER=s3` to select the provider through the environment. Environment values take precedence over saved settings and make the corresponding fields read only.

File System stores bytes directly on the application host and serves them through authenticated routes. The default directory is `~/.local/share/astralbeam/storage` on Linux, `~/Library/Application Support/AstralBeam/storage` on macOS, and `%LOCALAPPDATA%\AstralBeam\storage` on Windows. An absolute `XDG_DATA_HOME` overrides the Unix data location with `$XDG_DATA_HOME/astralbeam/storage`. `ASTRALBEAM_DATA_DIR` sets the default to `$ASTRALBEAM_DATA_DIR/storage`. Set an absolute **Storage directory** to choose another location, or clear it to restore the default. The server creates missing directories.

Keep this directory outside any web server's public root. Downloads authorize access and verify original file sizes and checksums. Writes are atomic and create missing directories. A missing storage root makes reads and deletions fail, so purges retain metadata for retry. The host and local processes are trusted.

Choose a persistent directory writable by the service account. Containers use `/var/lib/astralbeam`, owned by UID/GID `10001:10001`, and production Compose mounts its data volume there. File System is intended for a single host. All processes and maintenance runners must use the same directory. Use S3 for replicas on different hosts.

Filesystem responses hold a complete file in memory. Use normal ingress connection limits and timeouts for slow clients, and monitor storage capacity. Chat downloads retain their existing API limits.

Selecting S3-compatible shows the following settings, all of which retain their existing uppercase environment overrides:

| Setting | Required | Default | Notes |
| --- | --- | --- | --- |
| `s3_endpoint` | Yes | none | S3 API URL, including any path prefix such as `/storage/v1/s3`. HTTPS is required except for loopback and local `rustfs`/`minio` hosts |
| `s3_region` | Yes | none | Bucket region, or `auto` for Cloudflare R2 |
| `s3_bucket` | Yes | none | Private bucket dedicated to this deployment |
| `s3_access_key_id` | Yes | none | Storage access-key ID, independent of SES credentials |
| `s3_secret_access_key` | Yes | none | Storage secret access key |
| `s3_path_style` | Yes | `false` | Set to `true` for path-style backends such as MinIO |

1. Create a private bucket and credentials with object read, write, and delete access. AWS S3 also requires [bucket-level `s3:ListBucket` permission](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html) to distinguish missing files from denied reads. Versioned buckets need [`s3:DeleteObjectVersion`](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html) so connection tests permanently remove their temporary object version.
2. Enter its settings in **File storage** at `/configure`. The RustFS/MinIO, AWS S3, and Cloudflare R2 shortcuts prefill the endpoint, region, and addressing mode. Adjust these values for your provider, including the R2 account ID. Your bucket and credentials stay unchanged.
3. Press **Test storage** to upload, inspect, download, verify, delete, and confirm the temporary object is missing using the current values. Reveal stored credentials first if you have not entered new ones.
4. Save the configuration.

The test confirms object operations. Bucket privacy and browser CORS are separate provider settings.

For versioned buckets, configure your provider's lifecycle rules to expire temporary objects, noncurrent versions, and expired delete markers under `connection-tests/`. This cleans up interrupted tests and upload retries whose responses were lost. See [S3 expiration behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html).

You can change the provider, filesystem directory, endpoint, region, bucket, and addressing mode. **File storage** warns that existing attachments, avatars, and logos are not moved automatically and may become unavailable. To keep them, stop writers and maintenance runners, copy the objects to the new destination with their object keys unchanged, verify their sizes and checksums, save the new settings, and restart every server instance. Export RustFS objects through its S3 API rather than copying its internal data directory. Credential rotation remains supported.

The chat SDK requests direct S3 downloads and cached previews after conversation/file authorization. Configure the bucket's CORS policy to allow GET from your embedding origins, and expose `Content-Disposition` if consumers read that header. Keep the bucket private. Preview generation and model-side reads still run on AstralBeam, and File System downloads remain proxied. Signed chat URLs expire after one minute and must not be persisted. Existing HTTP clients can omit `delivery=direct` to retain proxied chat responses.

Both providers store avatars, logos, and published sandbox files. An S3 endpoint must be reachable from users' browsers. Signed S3 download URLs are private bearer links and remain valid until expiry, including after membership is revoked.

Conversation files remain until deletion and survive sandbox shutdown. Retired files are deleted asynchronously. Unattached uploads or direct SQL deletions can leave unreachable objects.

To rotate credentials, create a key with the same bucket permissions, enter it at `/configure`, test storage, and save. After the five-second configuration cache expires, verify uploads and downloads on every replica before revoking the old key. Keep destination fields unchanged.

Follow [Backups and restore](./operations.md#backups-and-restore) for coordinated backups. A database-only restore can reference missing objects. Bucket versioning can retain old bytes under a separate [retention policy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html).

Storage failures are logged without file content or credentials. Repair settings at `/configure` and test the connection so durable purges can retry.

## Model providers

Add and test providers under [Models](/docs/dashboard/models), then assign a model to an agent. Each organization, including the one running Astro, manages its own credentials. Deployment configuration does not copy model keys from the environment.

Endpoints require public HTTPS and cannot redirect by default. Enable `allow_private_model_endpoints` only for trusted organizations that need a private gateway such as Ollama. Its endpoint receives provider keys, conversations, and tool calls, so keep private access disabled on deployments shared by untrusted organizations.

## Sandbox providers

Each organization manages encrypted sandbox credentials under [Sandboxes](/docs/dashboard/sandboxes). Saving requires a passing connection test. Agents can run without a sandbox.

## Applying changes

Edit the fields you need and press **Save**. A successful save briefly reports "Configuration saved". **Go to app** becomes available once configuration and owner onboarding are complete.

The page saves changes together, so an invalid field blocks the batch and shows its error inline. Required settings cannot be empty. To clear an optional setting, delete its contents and save. For an unreadable optional value, reveal it if it is a secret, press Delete in its empty input, and save. Resetting an enum to **Use default** restores its default.

A save takes effect immediately on the process that handled it. Other replicas refresh their snapshot on the next read after its five-second cache expires. Observability exporters are created once at startup, so restart every server instance after changing observability settings. Environment changes also require a restart.

While required settings are missing, the page lists each one and the application stays gated.

| Message | Fix |
| --- | --- |
| `<field> is required` | Fill in the setting. It is one of the required keys above |
| `A valid email from address is required when an email provider is selected` | Set `email_from_address`, or check its shape |
| `Resend is the selected email provider but no Resend API key is configured` | Add `resend_api_key` or switch the provider |
| `SES is the selected email provider but no AWS region is configured` | Add `aws_region` |
| `<field> is required when its pair is configured` | Supply both SMTP credentials or neither |
| `This value is provided by <VARIABLE>` | Change the environment variable and restart, or remove it |

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

For a hosted receiver, use its official endpoint and authentication headers. Check that it accepts the signals you enable. Presets fill only the base endpoint, preserving credentials and labels. Replace placeholders, save, and restart. Make a request and check the receiver after allowing time for ingestion.

| Receiver | OTLP base endpoint | Headers |
| --- | --- | --- |
| Local OpenTelemetry Collector, Tempo, or Datadog Agent | `http://127.0.0.1:4318` | Depends on the receiver. Enable its OTLP HTTP listener first |
| [PostHog](https://posthog.com/docs/distributed-tracing/installation/nodejs) | `https://us.i.posthog.com/i` | `Authorization=Bearer <project-token>` |
| [New Relic](https://docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/) | `https://otlp.nr-data.net` | `api-key=<license-key>` |
| [Datadog](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/traces/) | `https://otlp.datadoghq.com` | `dd-api-key=<api-key>` |
| [Sentry](https://docs.sentry.io/concepts/otlp/direct/traces/) | Copy the project's OTLP endpoint and remove `/v1/traces` | `x-sentry-auth=sentry sentry_key=<public-key>`. Find both values in **Project settings → Client Keys (DSN)** |
| [Honeycomb](https://docs.honeycomb.io/send-data/opentelemetry/) | `https://api.honeycomb.io` | `x-honeycomb-team=<ingest-key>`. Classic also requires `x-honeycomb-dataset` |
| [Grafana Cloud](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/) | Copy the stack's OTLP base endpoint, typically `https://<otlp-host>/otlp` | Copy the stack's generated `Authorization=Basic …` header |

The presets cover Local, PostHog, New Relic, Datadog, Sentry, and Honeycomb. For other regions or receivers, use the provider's base endpoint. If its instructions supply a full traces URL, remove the trailing `/v1/traces` before entering it here.

Existing Effect operations and TanStack's model and tool spans share the exporter. They include durations, model names, token counts, prompts, responses, tool arguments and results. Failed operations retain exception types, messages, cause-chain stacks and status descriptions with credential patterns redacted. SQL text and credential-bearing URL fields are excluded.

Log shipping uses [Effect's native OTLP logger](https://effect.website/docs/v4/api/effect/observability/OtlpLogger). Console and shipped logs share credential redaction. Shipped logs include messages, full causes, request metadata, and active trace/span IDs. Request and error logs outside the application runtime use the exporter after it initializes. Earlier logs remain console-only. Log export uses generic OTLP headers, not traces-specific headers.

Native issue grouping depends on the receiver. Failed spans include `error.type`, `error.message`, and `error.stack` alongside exception events for receivers such as Datadog. Sentry's direct OTLP ingestion does not replace its native exception capture.

Browser correlation uses the standard `user.id` and `session.id` attributes on spans and shipped logs for every OTLP receiver. Provider-specific aliases are added only to that provider's exports.

Set `deployment.environment.name` and `service.instance.id` through **OTel resource attributes** or `OTEL_RESOURCE_ATTRIBUTES` to filter spans and logs by environment and process. Restart after changing them. An environment override replaces stored labels, allowing replicas sharing a database to identify themselves separately.

### PostHog errors and AI observability

The US or EU PostHog OTLP receiver also enables backend errors and AI observability using its configured bearer token. Switching receivers or disabling telemetry disables backend PostHog capture. Hosted browser analytics remain independent.

### Source maps for custom builds

Platform and website production builds generate hidden source maps and deterministic debug IDs without upload credentials. IDs include the Git revision and source positions, so older deployments retain their matching maps and release. Set `SOURCE_VERSION` to the commit SHA when building without Git metadata, including custom Docker builds with `--build-arg SOURCE_VERSION=<sha>`. Each build collects its matching JavaScript and maps under `.output/sourcemaps`, outside served assets and compiled binaries. Use that directory with any compatible uploader.

For PostHog, run `bun run sourcemaps:posthog --directory .output/sourcemaps` from the project directory after building. The command binds maps to the CLI's Git release. When uploading outside the original checkout, pass `--release-version <sha>` matching `SOURCE_VERSION`. Set `POSTHOG_CLI_API_KEY` to a personal API key with error tracking write and organization read scopes, and `POSTHOG_CLI_PROJECT_ID` to the project ID. `POSTHOG_CLI_HOST` optionally selects another region or instance. Keep these credentials in the CI upload step. Uploads leave the generated files unchanged, so the same artifact can be sent to multiple destinations.

For GitHub releases, add the `POSTHOG_API_KEY` repository secret and `POSTHOG_PROJECT_ID` repository variable, plus `POSTHOG_HOST` if needed. CI uploads the regular release build's source maps directly to PostHog. Docker builds remain independent of PostHog and reuse those maps when their emitted debug IDs match. A different set of Docker bundles requires uploading its matching maps separately.
