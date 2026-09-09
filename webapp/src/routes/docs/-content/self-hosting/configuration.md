# Configuration

Everything except the two bootstrap variables in [Deploy](./deploy.md) is a stored setting you edit in the browser. This page is the inventory: what each setting does, what it accepts, and what the application does while it is unset.

## Where settings live

Stored settings are rows in the `config` table, and their values are encrypted at rest. The operator page at `/configure` is the only editor. Sign in there with the first entry of `DATABASE_ENCRYPTION_KEY`, as described in [Security](./security.md).

A value in effect is resolved in this order, last one winning.

1. The setting's built-in default, if it has one.
2. The stored value in `config`, written by `/configure`.
3. An uppercase environment variable of the same name.

Every field on the page is badged **Database** or **Environment** so you can see which source is in effect. Secret values are never sent to the browser on page load. A field that holds a stored secret shows `Configured` and reveals its value only when you ask for that one key.

## Environment overrides

Any setting below can be supplied as an environment variable named after the setting in uppercase, so `app_base_url` becomes `APP_BASE_URL` and `smtp_port` becomes `SMTP_PORT`. An override behaves differently from a stored value in three ways.

- It takes precedence over the stored value, and the stored value is not even read for that key.
- Its field at `/configure` becomes read only, and attempting to save it returns `This value is provided by <VARIABLE>`.
- It is read once at startup, so changing or removing it requires a restart.

An empty variable counts as unset. Values are parsed as JSON when they happen to be valid JSON, and otherwise taken as a plain string, so ordinary unquoted values work as expected. An invalid override fails at startup with the variable name and the reason, for example `SMTP_PORT: SMTP port must be between 1 and 65535`.

## General

| Setting                | Required | Default | Notes                                                                                    |
| ---------------------- | -------- | ------- | ---------------------------------------------------------------------------------------- |
| `app_base_url`         | Yes      | none    | Public origin the deployment is served from. Used for OAuth callbacks and links in email |
| `privacy_policy_url`   | No       | none    | Public HTTP or HTTPS link shown during sign-up                                           |
| `terms_of_service_url` | No       | none    | Public HTTP or HTTPS link shown during sign-up                                           |

The base URL must be an origin and nothing more: no path, query, fragment, or embedded credentials. HTTPS is required unless the host is loopback (`localhost`, `127.0.0.1`, or `[::1]`), which keeps plain HTTP available for local development only. A rejected value reports `Application base URL must be an HTTP(S) origin without credentials, path, query, or fragment, and must use HTTPS outside local development`.

When either legal URL is configured, sign-up requires the user to accept those terms before the form can be submitted. Leave both unset and no acceptance step appears.

## Authentication

| Setting                | Required | Default | Notes                                                                       |
| ---------------------- | -------- | ------- | --------------------------------------------------------------------------- |
| `better_auth_secret`   | Yes      | none    | At least 32 characters. Generated for you on the first save when left unset |
| `turnstile_site_key`   | Yes      | none    | Cloudflare Turnstile public site key, sent to browsers                      |
| `turnstile_secret_key` | Yes      | none    | Cloudflare Turnstile server-only secret                                     |
| `google_client_id`     | No       | none    | Set with `google_client_secret` or not at all                               |
| `google_client_secret` | No       | none    | Paired with `google_client_id`                                              |
| `github_client_id`     | No       | none    | Set with `github_client_secret` or not at all                               |
| `github_client_secret` | No       | none    | Paired with `github_client_id`                                              |

The authentication secret signs sessions and tokens. The field offers **Generate** when it is unset and **Rotate** when it is set, and rotating it signs every dashboard user out immediately.

Both Turnstile keys are mandatory, so setup cannot complete without them. Create a widget in the Cloudflare dashboard, restrict it to the hostnames that serve this deployment, and store both keys here. Cloudflare publishes test keys for local and automated use.

Each social provider needs both halves of its pair. Setting one alone leaves setup incomplete with `<field> is required to enable this sign-in provider`, and a provider appears on the sign-in page only when both halves are present. Register these exact callback URLs with the provider, derived from the configured base URL:

```text
<app_base_url>/api/auth/callback/google
<app_base_url>/api/auth/callback/github
```

## Email delivery

| Setting                 | Required      | Default     | Notes                                                    |
| ----------------------- | ------------- | ----------- | -------------------------------------------------------- |
| `email_provider`        | No            | `smtp`      | One of `smtp`, `resend`, `ses`                           |
| `email_from_address`    | Unless `smtp` | none        | `email@example.com` or `Name <email@example.com>`        |
| `smtp_host`             | No            | `127.0.0.1` | Mail server hostname                                     |
| `smtp_port`             | No            | `1025`      | 1 to 65535                                               |
| `smtp_security`         | No            | `none`      | One of `none`, `auto`, `starttls`, `tls`                 |
| `smtp_username`         | No            | none        | Set with `smtp_password` or not at all                   |
| `smtp_password`         | No            | none        | Paired with `smtp_username`                              |
| `resend_api_key`        | When `resend` | none        | Resend API key with sending access                       |
| `aws_region`            | When `ses`    | none        | SES Region. Identities and sandbox status are per Region |
| `aws_access_key_id`     | No            | none        | Set with `aws_secret_access_key` or not at all           |
| `aws_secret_access_key` | No            | none        | Paired with `aws_access_key_id`                          |

The defaults point at an unencrypted local SMTP server, which is the development sink and not something to keep in production. For a hosted server, set the host and port and choose the security mode: `none` disables TLS, `auto` uses STARTTLS when the server advertises it and otherwise stays unencrypted, `starttls` requires STARTTLS (usually port 587), and `tls` starts the connection with TLS (usually port 465). Supply the username and password together to authenticate, or omit both to send unauthenticated.

With `resend` or `ses`, a valid from address is required, and its shape is validated here because both APIs reject anything else. With `smtp`, leaving it unset derives `no-reply@<hostname>` from the base URL.

For SES, leave both AWS credential fields unset to use the deployment's own credential chain, such as an instance role or a local profile. That is the recommended setup. Fill both in only for static keys. Supplying just one leaves setup incomplete with `<field> is required to use static AWS credentials`, and doing the same through the environment reports `AWS_SECRET_ACCESS_KEY is required when the paired AWS credential is supplied through the environment`.

Configure one provider per deployment and leave the other providers' credentials unset.

## Model provider

| Setting          | Required | Default | Notes                                                  |
| ---------------- | -------- | ------- | ------------------------------------------------------ |
| `openai_api_key` | No       | none    | Powers the chat endpoint. Chat fails while it is unset |

This key is not part of the setup gate, so the application will open to users without it. Until it is set, every chat request is refused with `503` and the detail `Chat is not configured.`, which reaches the embedded widget as an error rather than a reply.

## Sandbox providers

Sandbox credentials are not deployment settings and are not on this page. Each organization configures its own named providers in the dashboard, under **Sandboxes**, and those credentials are stored encrypted per organization. A provider cannot be saved until its connection test passes, and an agent's sandbox provider stays optional.

## Applying changes

Edit the fields you need and press **Save**. The page saves the whole set of changes together, so a single invalid field blocks the batch and shows its message inline. A required setting cannot be emptied, which reports `Required configuration cannot be cleared`. An optional setting is cleared with **Clear value**, and an enum reset to **Use default** returns to its default.

The Email Delivery group has a **Test connection** action that checks the settings currently in the form, including unsaved edits, without sending any email. A successful SMTP test reports that DNS, SMTP, the selected security mode, and authentication passed. The SES test calls `GetAccount`, so its credentials also need the `ses:GetAccount` permission, and it confirms that account sending is enabled.

A save takes effect immediately on the process that handled it. Other replicas keep their cached snapshot until they restart, which the page states as "Saved changes apply immediately on this server. Restart other running server instances to load them." Roll a restart across the fleet after any configuration change.

While required settings are missing, the page lists each one and the application stays gated. Common messages and what they mean:

| Message                                                                     | Fix                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------- |
| `<field> is required`                                                       | Fill in the setting. It is one of the required keys above |
| `A valid email from address is required when an email provider is selected` | Set `email_from_address`, or check its shape              |
| `Resend is the selected email provider but no Resend API key is configured` | Add `resend_api_key` or switch the provider               |
| `SES is the selected email provider but no AWS region is configured`        | Add `aws_region`                                          |
| `<field> is required when its pair is configured`                           | Supply both SMTP credentials or neither                   |
| `This value is provided by <VARIABLE>`                                      | Change the environment variable and restart, or remove it |
