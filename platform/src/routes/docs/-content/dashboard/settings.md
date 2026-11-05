# Settings

Open **Settings** to update your organization's name, logo, and dashboard URL. Only owners can change organization settings.

## The name

The name appears in the dashboard and invitation emails. Changing it does not affect embedded chat.

## The URL slug

The slug identifies the organization in dashboard URLs, such as `/<slug>/agents`.

Use 1–63 lowercase letters, digits, or hyphens. The slug must be unique and cannot use reserved paths such as `docs` or `api`.

**NOTE**: Changing the slug breaks existing dashboard bookmarks, shared links, and open tabs. Saving redirects your current tab only.

The organization's immutable UUID remains unchanged. Agent IDs, API keys, tokens, and embedded applications continue working.

## Who can change these

Only owners can edit organization settings. Owners and developers manage integrations on their own dashboard pages. See [Members](./members.md) for roles.

## Deleting the organization

**NOTE**: Deletion cannot be undone. It immediately ends dashboard access and invalidates the organization's API keys and chat tokens.

In **Settings**, choose **Delete organization**, enter the organization's slug to confirm, then choose **Delete organization** again.

Organization data is removed in the background. Owners receive a confirmation email, and the slug becomes available once cleanup finishes. The deployment's own organization, which powers the dashboard assistant, cannot be deleted.

## Settings that live elsewhere

- Model providers, their credentials, and enabled models: [Models](./models.md).
- Agents, their instructions, model choices, and which agent is the default: [Agents](./agents.md).
- Sandbox providers and their credentials: [Sandboxes](./sandboxes.md).
- API keys for the management API and for signing chat tokens: [API keys](./api-keys.md).
- Who can sign in and what each role may do: [Members](./members.md).

Deployment caps on requests, attachments, and sandboxes cannot be raised here. See [Limits](/docs/sdk/limits). Configure your own token and spend allowances under [Usage limits](./usage-limits.md).

## Logo and domain

Choose the logo under **Settings** to upload a PNG, JPEG, GIF, or WebP image. Logo changes save immediately. Use **Change logo** to replace or remove it, or **Refresh logo from domain** when no logo is set.

The read-only **Domain** comes from the creator's email address. It does not verify domain ownership.

## Your own account

Open your account from your name in the sidebar to change your display name. Update your organization avatar under **Members**. Your sign-in email cannot be changed from the dashboard.

Use the adjacent security page to manage passwords, connected sign-in providers, and active sessions. Revoke a session to disconnect a device. Changing your password revokes your other sessions.
