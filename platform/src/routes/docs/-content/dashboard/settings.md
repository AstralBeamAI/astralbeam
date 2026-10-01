# Settings

Organization settings control the display name and URL slug. Let's look at what changes when we edit them and where to configure the rest of the organization.

## The name

The name identifies the organization to your colleagues, up to 100 characters. It appears in the dashboard, in the organization switcher, and in the subject line and body of invitation emails.

The name is display text only, as nothing about the embedded chat depends on it and tenant users never see it.

## The URL slug

The slug is the first segment of every dashboard URL for this organization, as in `/<slug>/agents`, and it is only ever a URL.

A slug is 1 to 63 characters of lowercase letters, digits, and hyphens. It has to be unique across all organizations, so a slug you want may already be taken, and it cannot be one of the words the application uses for its own top-level paths, such as `docs`, `api`, `settings`, and `organizations`.

**NOTE**: changing the slug breaks every existing dashboard URL for the whole organization at once, as bookmarks, links in your runbooks and tickets, and any tab a colleague has open all stop resolving.

Saving moves you to the new URL, and nobody else is moved.

Nothing outside the dashboard depends on the slug. The organization's real identity is a permanent internal ID, which is what public agent IDs, API keys, and chat auth tokens are built from, so a slug change never affects embedded chat, tokens already minted, or applications in production.

## Who can change these

Only owners. Developers and viewers do not see this page in the sidebar and are returned to the organization home when they open its URL. Owners and developers manage model providers separately in [Models](./models.md). See [Members](./members.md).

## Deleting the organization

Owners can delete an organization from the **Delete organization** card at the bottom of this page. Let's confirm by typing the organization's slug in the dialog and pressing **Delete organization**.

Every member, pending invitation, and API key is removed at once, so dashboard access, management API calls, and chat auth tokens stop working immediately. Agents, model providers, sandbox providers, tenants, and tenant users are then removed in the background, and the slug becomes available again when that finishes. Every owner then receives an email confirming the deletion.

**NOTE**: deletion cannot be undone. The deployment's own organization, which powers the dashboard assistant, cannot be deleted.

## Settings that live elsewhere

- Model providers, their credentials, and enabled models: [Models](./models.md).
- Agents, their instructions, model choices, and which agent is the default: [Agents](./agents.md).
- Sandbox providers and their credentials: [Sandboxes](./sandboxes.md).
- API keys for the management API and for signing chat tokens: [API keys](./api-keys.md).
- Who can sign in and what each role may do: [Members](./members.md).

Limits on requests, attachments, and sandboxes belong to the deployment rather than to your organization and cannot be raised from here, and they are listed in [Limits](/docs/sdk/limits).

## Your own account

Your display name and avatar are yours rather than the organization's, and you change them on your account page, reached from your name at the bottom of the sidebar. Your sign-in email address cannot be changed from the dashboard.

Your password, your connected sign-in providers, and your active sessions are on the security page alongside it. Revoking a session there is the fastest way to cut off a device you no longer control, and changing your password revokes your other sessions for you.
