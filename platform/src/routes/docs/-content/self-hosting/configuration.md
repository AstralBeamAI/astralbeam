# Configuration

Application settings live in the database and are edited in the browser. The required bootstrap variables, HTTP listen port, and private cluster runner addresses are environment-only settings described in [Deploy](./deploy.md#3-set-the-bootstrap-environment).

## Where settings live

Stored settings are rows in the `config` table, and their values are encrypted at rest. The operator page at `/configure` is the only editor, and we sign in there with the first entry of `DATABASE_ENCRYPTION_KEY`, as described in [Security](./security.md).

A value in effect is resolved in this order, last one winning.

1. The setting's built-in default, if it has one.
2. The stored value in `config`, written by `/configure`.
3. An uppercase environment variable of the same name.

Every field on the page is badged **Database** or **Environment**, so you can see which source is in effect. Secret values are never sent to the browser on page load. A field that holds a stored secret shows `Configured` and reveals its value only when you ask for that one key.

## Environment overrides

Any setting below can be supplied as an environment variable named after the setting in uppercase, so `app_base_url` becomes `APP_BASE_URL` and `smtp_port` becomes `SMTP_PORT`. An override behaves differently from a stored value in three ways.

- It takes precedence over the stored value, and the stored value is not even read for that key.
- Its field at `/configure` becomes read only, and attempting to save it returns `This value is provided by <VARIABLE>`.
- It is read once at startup, so changing or removing it requires a restart.

Values are parsed as JSON when they happen to be valid JSON, and otherwise taken as a plain string, so ordinary unquoted values work as expected. An invalid override fails at startup with the variable name and the reason, for example `SMTP_PORT: SMTP port must be between 1 and 65535`.

**NOTE**: An empty variable counts as unset, so the stored value applies again.

## General

| Setting | Required | Default | Notes |
| --- | --- | --- | --- |
| `app_base_url` | Yes | none | Public origin the deployment is served from. Used for OAuth callbacks and links in email |
| `privacy_policy_url` | No | none | Public HTTP or HTTPS link shown during sign-up |
| `terms_of_service_url` | No | none | Public HTTP or HTTPS link shown during sign-up |
| `support_email_address` | Yes | none | Copied on welcome and support request emails, so replies and **Contact Support** requests reach your team |
| `website_url` | No | none | Origin of a separately hosted website to serve under this deployment's origin |
| `allow_private_model_endpoints` | No | `false` | `true` lets model provider connections use HTTP and private network hosts |

The base URL must be an origin and nothing more: no path, query, fragment, or embedded credentials. HTTPS is required unless the host is loopback (`localhost`, `127.0.0.1`, or `[::1]`), which keeps plain HTTP available for local development only. A rejected value reports `Application base URL must be an HTTP(S) origin without credentials, path, query, or fragment, and must use HTTPS outside local development`.

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

The authentication secret signs sessions and tokens. The field offers **Generate** when it is unset and **Rotate** when it is set, and a successful generation reports "New secret generated". Rotating it signs every dashboard user out immediately.

Both Turnstile keys are mandatory, so setup cannot complete without them. Create a widget in the Cloudflare dashboard, restrict it to the hostnames that serve this deployment, and store both keys here. Cloudflare publishes test keys for local and automated use.

Each social provider needs both halves of its pair. Setting one alone leaves setup incomplete with `<field> is required to enable this sign-in provider`, and a provider appears on the sign-in page only when both halves are present.

Register these exact callback URLs with the provider, derived from the configured base URL:

```text
<app_base_url>/api/auth/callback/google
<app_base_url>/api/auth/callback/github
```

## Email delivery

| Setting | Required | Default | Notes |
| --- | --- | --- | --- |
| `email_provider` | No | `smtp` | One of `smtp`, `resend`, `ses` |
| `email_from_address` | Unless `smtp` | none | `email@example.com` or `Name <email@example.com>` |
| `smtp_host` | No | `127.0.0.1` | Mail server hostname |
| `smtp_port` | No | `1025` | 1 to 65535 |
| `smtp_security` | No | `none` | One of `none`, `auto`, `starttls`, `tls` |
| `smtp_username` | No | none | Set with `smtp_password` or not at all |
| `smtp_password` | No | none | Paired with `smtp_username` |
| `resend_api_key` | When `resend` | none | Resend API key with sending access |
| `aws_region` | When `ses` | none | SES Region. Identities and sandbox status are per Region |
| `aws_access_key_id` | No | none | Set with `aws_secret_access_key` or not at all |
| `aws_secret_access_key` | No | none | Paired with `aws_access_key_id` |

The defaults point at an unencrypted local SMTP server, which is the development sink and not something to keep in production. For a hosted server, set the host and port and choose the security mode: `none` disables TLS, `auto` uses STARTTLS when the server advertises it and otherwise stays unencrypted, `starttls` requires STARTTLS (usually port 587), and `tls` starts the connection with TLS (usually port 465). Supply the username and password together to authenticate, or omit both to send unauthenticated.

With `resend` or `ses`, a valid from address is required, and its shape is validated here because both APIs reject anything else. With `smtp`, leaving it unset derives `no-reply@<hostname>` from the base URL.

For SES, we should leave both AWS credential fields unset so the deployment uses its own credential chain, such as an instance role or a local profile. Fill both in only for static keys. Supplying just one leaves setup incomplete with `<field> is required to use static AWS credentials`, and doing the same through the environment reports `AWS_SECRET_ACCESS_KEY is required when the paired AWS credential is supplied through the environment`.

**TIP**: Configure one provider per deployment and leave the other providers' credentials unset.

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

The first application upload pins the endpoint, region, bucket, and addressing mode. These values cannot change afterwards until a storage migration is available. Credential rotation remains supported. A failed first upload can also pin the destination because the server reserves it before contacting storage, preventing concurrent configuration changes from losing an object.

Avatars and Organization logos use authenticated application URLs. Images must be valid, non-animated PNG, JPEG, GIF, or WebP files within 2 MiB and 16 megapixels. The server imports Gravatar after account creation or an email change, and imports external logos submitted through the Organization API. Sign-in never imports an image. Imports retry transient external-fetch failures up to eight times and storage failures indefinitely. A pending Gravatar import may replace a manually selected avatar. If the process stops between the account commit and workflow submission, that optional import may be missed.

For an existing deployment, let's back up the database and configure storage before applying the file migration. It clears historical avatars and logos, leaving chat messages and attachments unchanged. Users see initials until they upload an avatar. The existing FileMaintenance schedule submits pending logo imports and object cleanup to durable workflows.

Replacement and SQL cascades retain deletion targets until object deletion succeeds. Keep database and object backups together, because restoring database references requires their matching objects.

## Model providers

Model provider keys are not deployment settings and are not on this page. Each organization adds named connections in [Models](/docs/dashboard/models), with its own encrypted API key, API URL, and enabled models. Multiple connections can use OpenAI with different credentials or endpoints.

The application opens to users before model setup is complete. Let's add a provider, enable its models, then assign a default model to an agent. Until an agent has a usable model configuration, its chat requests fail with `503` and the widget shows an error. The organization's home page shows the remaining setup steps.

Provider API URLs must use HTTPS and reach a public address by default. A save refuses a loopback, private, carrier-grade NAT, link-local, unique local, or unspecified host, including the cloud metadata address `169.254.169.254`, with `Use a public HTTPS API URL. This server does not allow HTTP or private network endpoints`. Every provider request also resolves the host, refuses a private address, and does not follow redirects. Set `allow_private_model_endpoints` to `true` when your organizations need a LAN gateway such as Ollama. Keep it off when untrusted organizations share the deployment, because a connection's URL receives its key, the conversation, and tool calls.

The deployment's dogfood organization follows the same process. After accepting the owner invitation, open that organization's **Models** page and configure the provider and agent that power Astro. Saving deployment configuration or sending the invitation does not copy a model key from the server environment.

## Sandbox providers

Sandbox credentials are not deployment settings and are not on this page. Each organization configures its own named providers in the dashboard, under **Sandboxes**, and those credentials are stored encrypted per organization. A provider cannot be saved until its connection test passes, and an agent's sandbox provider stays optional.

## Applying changes

Edit the fields you need and press **Save**. A successful save reports "Configuration saved", and the alert at the top of the page switches to "Configuration is complete" once nothing required is missing.

The page saves the whole set of changes together, so a single invalid field blocks the batch and shows its message inline. A required setting cannot be emptied, which reports `Required configuration cannot be cleared`. An optional setting is cleared with **Clear value**, and an enum reset to **Use default** returns to its default.

The Email Delivery group has a **Test connection** action that checks the settings currently in the form, including unsaved edits, without sending any email. A successful SMTP test reports that DNS, SMTP, the selected security mode, and authentication passed. The SES test calls `GetAccount`, so its credentials also need the `ses:GetAccount` permission, and it confirms that account sending is enabled.

A save takes effect immediately on the process that handled it. Other replicas keep their cached snapshot until they restart, which the page states as "Saved changes apply immediately on this server. Restart other running server instances to load them." Roll a restart across the fleet after any configuration change.

While required settings are missing, the page lists each one and the application stays gated.

| Message | Fix |
| --- | --- |
| `<field> is required` | Fill in the setting. It is one of the required keys above |
| `A valid email from address is required when an email provider is selected` | Set `email_from_address`, or check its shape |
| `Resend is the selected email provider but no Resend API key is configured` | Add `resend_api_key` or switch the provider |
| `SES is the selected email provider but no AWS region is configured` | Add `aws_region` |
| `<field> is required when its pair is configured` | Supply both SMTP credentials or neither |
| `This value is provided by <VARIABLE>` | Change the environment variable and restart, or remove it |
