# Configuration

Configure the deployment at `/configure`. Bootstrap credentials, the listen port, and private runner addresses are set through the environment. See [Deploy](./deploy.md#3-set-the-bootstrap-environment).

## Complete the initial configuration

1. Sign in with the active `DATABASE_ENCRYPTION_KEY`.
2. Set the public base URL and support address under **General**.
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
| `app_base_url` | Yes | none | Public origin the deployment is served from. Used for OAuth callbacks and links in email |
| `privacy_policy_url` | No | none | Public HTTP or HTTPS link shown during sign-up |
| `terms_of_service_url` | No | none | Public HTTP or HTTPS link shown during sign-up |
| `support_email_address` | Yes | none | Copied on welcome and support request emails, so replies and **Contact Support** requests reach your team |
| `website_url` | No | none | Origin of a separately hosted website to serve under this deployment's origin |
| `allow_private_model_endpoints` | No | `false` | `true` lets model provider connections use HTTP and private network hosts |

The base URL must be an HTTP(S) origin without a path, query, fragment, or embedded credentials. HTTP is accepted for loopback hosts (`localhost`, `127.0.0.1`, or `[::1]`) or when `ALLOW_INSECURE=true`. Production HTTP deployments, including localhost, need this environment flag to access `/configure`.

When `website_url` is set, signed-out visitors to `/` and everyone at `/home` see the website's home page, and the website's own pages such as `/terms` and `/privacy` are served under the deployment's origin. Signed-in visitors to `/` still go to their organization.

When either legal URL is configured, sign-up requires the user to accept those terms before the form can be submitted. Leave both unset and no acceptance step appears.

## Authentication

| Setting | Required | Default | Notes |
| --- | --- | --- | --- |
| `better_auth_secret` | Yes | none | At least 32 characters. Generated for you on the first save when left unset |
| `turnstile_site_key` | Yes | none | Cloudflare Turnstile public site key, sent to browsers |
| `turnstile_secret_key` | Yes | none | Cloudflare Turnstile server-only secret |
| `google_client_id` | No | none | Set with `google_client_secret` or not at all |
| `google_client_secret` | No | none | Paired with `google_client_id` |
| `github_client_id` | No | none | Set with `github_client_secret` or not at all |
| `github_client_secret` | No | none | Paired with `github_client_id` |

Use **Generate** for a new authentication secret or **Rotate** to replace it. Rotation immediately signs out every dashboard user.

Both Turnstile keys are mandatory, so setup cannot complete without them. Create a widget in the Cloudflare dashboard, restrict it to the hostnames that serve this deployment, and store both keys here. Cloudflare publishes [test keys for local and automated use](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

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

File storage uses one private S3-compatible bucket per deployment. Let's configure it before completing setup.

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
4. Save the configuration and restart other running server instances.

The test confirms object operations. Bucket privacy and browser CORS are separate provider settings.

For versioned buckets, configure your provider's lifecycle rules to expire temporary objects, noncurrent versions, and expired delete markers under `connection-tests/`. This cleans up interrupted tests and upload retries whose responses were lost. See [S3 expiration behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html).

You can change the endpoint, region, bucket, and addressing mode at any time. **File storage** warns that existing attachments, avatars, and logos are not moved automatically and may become unavailable. To keep them, let's stop writers and maintenance runners, copy the objects to the new destination with their object keys unchanged, save the new settings, and restart every server instance. Credential rotation remains supported.

The bucket also stores avatars, logos, and published sandbox files. Its endpoint must be reachable from users' browsers. Signed download URLs are private bearer links and remain valid until expiry, including after membership is revoked.

Conversation files remain until deletion and survive sandbox shutdown. Retired files are deleted asynchronously. Unattached uploads or direct SQL deletions can leave unreachable objects.

To rotate credentials, create a key with the same bucket permissions, enter it at `/configure`, test storage, and save. Restart other replicas and verify uploads and downloads before revoking the old key. Keep destination fields unchanged.

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

A save takes effect immediately on the process that handled it, except observability, whose exporters are created once at startup. Other replicas keep their cached snapshot until they restart. Roll a restart across the fleet after any configuration change, including the saving server when observability changes.

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

Existing Effect operations and TanStack's model and tool spans share the exporter. They include durations, model names, token counts and error types. Prompt, response, tool argument and result capture stays disabled. SQL text and raw exception content are excluded.

Log shipping uses [Effect's native OTLP logger](https://effect.website/docs/v4/api/effect/observability/OtlpLogger). Console and shipped logs share credential redaction. Shipped logs include messages, full causes, request metadata, and active trace/span IDs. Request and error logs outside the application runtime use the exporter after it initializes. Earlier logs remain console-only. Log export uses generic OTLP headers, not traces-specific headers.

Set `deployment.environment.name` and `service.instance.id` through **OTel resource attributes** or `OTEL_RESOURCE_ATTRIBUTES` to filter spans and logs by environment and process. Restart after changing them. An environment override replaces stored labels, allowing replicas sharing a database to identify themselves separately.
