# Settings

Owners manage the organization's display name and slug under **Settings**. Other configuration has its own dashboard pages, linked below.

## The name

The name appears in the dashboard, organization switcher, and invitation emails. It accepts up to 100 characters. Tenant users do not see it, and changing it does not affect embedded chat.

## The URL slug

The slug identifies the organization in dashboard URLs, such as `/<slug>/agents`.

Use 1–63 lowercase letters, digits, or hyphens. The slug must be unique and cannot use reserved paths such as `docs` or `api`.

**NOTE**: Changing the slug breaks existing dashboard bookmarks, shared links, and open tabs. Saving redirects your current tab only.

The organization's immutable UUID remains unchanged. Agent IDs, API keys, tokens, and embedded applications continue working.

## Who can change these

Only owners can edit these settings. Owners and developers manage providers separately under [Models](./models.md). See [Members](./members.md) for roles.

## Deleting the organization

1. Find **Delete organization** at the bottom of **Settings**.
2. Enter the organization's slug in the confirmation dialog.
3. Choose **Delete organization**.

Every member, pending invitation, and API key is removed at once, so dashboard access, management API calls, and chat auth tokens stop working immediately. Agents, model providers, sandbox providers, tenants, and tenant users are then removed in the background, and the slug becomes available again when that finishes. Every owner then receives an email confirming the deletion.

**NOTE**: deletion cannot be undone. The deployment's own organization, which powers the dashboard assistant, cannot be deleted.

## Settings that live elsewhere

- Model providers, their credentials, and enabled models: [Models](./models.md).
- Agents, their instructions, model choices, and which agent is the default: [Agents](./agents.md).
- Sandbox providers and their credentials: [Sandboxes](./sandboxes.md).
- API keys for the management API and for signing chat tokens: [API keys](./api-keys.md).
- Who can sign in and what each role may do: [Members](./members.md).

Deployment caps on requests, attachments, and sandboxes cannot be raised here. See [Limits](/docs/sdk/limits). Configure your own token and spend allowances under [Usage limits](./usage-limits.md).

## Logo and domain

Upload or remove the Organization logo under **Settings**. These changes save immediately. PNG, JPEG, GIF, and WebP images are supported. If the logo is empty, use **Refresh logo** to request an update.

The required, read-only **Domain** field starts with the creator's email domain. It does not verify domain ownership. Domain editing is unavailable.

## Your own account

Open your account from your name at the bottom of the sidebar to change your display name. Update your personal Organization avatar under **Members**. Your sign-in email cannot be changed from the dashboard.

Use the adjacent security page to manage passwords, connected sign-in providers, and active sessions. Revoke a session to disconnect a device. Changing your password revokes your other sessions.
