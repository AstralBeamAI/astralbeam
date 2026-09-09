# Settings

An organization has two settings of its own: a display name and a URL slug. Both are owner-only. Everything else about how the embedded agent behaves is configured on the other pages in this section.

## The name

The name identifies the organization to your colleagues. It appears in the dashboard, in the organization switcher, and in the subject line and body of invitation emails, up to 100 characters.

It is display text only. Nothing about the embedded chat depends on it, and tenant users never see it.

## The URL slug

The slug is the first segment of every dashboard URL for this organization, as in `/<slug>/agents`. It is only ever a URL.

| Rule       | Value                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| Characters | Lowercase letters, digits, and hyphens                                                                         |
| Length     | 1 to 63 characters                                                                                             |
| Uniqueness | Unique across all organizations, so a wanted slug may already be taken                                         |
| Reserved   | Words the application uses for its own top-level paths, such as `docs`, `api`, `settings`, and `organizations` |

Changing the slug breaks every existing dashboard URL for the whole organization at once. Bookmarks, links in your own runbooks and tickets, and any browser tab a colleague has open all stop resolving. Saving moves you to the new URL, but nobody else is moved.

Nothing outside the dashboard depends on the slug. The organization's real identity is a permanent internal ID, which is what public agent IDs, API keys, and chat auth tokens are built from, so a slug change never affects embedded chat, tokens already minted, or applications in production.

## Who can change these

Only owners. Developers and viewers do not see this page in the sidebar and are returned to the organization home if they open its URL. See [Members](./members.md).

An organization cannot be deleted from the dashboard.

## Settings that live elsewhere

- Agents, their instructions, and which one is the default: [Agents](./agents.md).
- Sandbox providers and their credentials: [Sandboxes](./sandboxes.md).
- API keys for the management API and for signing chat tokens: [API keys](./api-keys.md).
- Who can sign in and what each role may do: [Members](./members.md).

Limits on requests, attachments, and sandboxes belong to the deployment rather than to your organization and cannot be raised from here. They are listed in [Limits](/docs/sdk/limits).

## Your own account

Your display name and avatar are yours, not the organization's, and are changed on your account page, reached from your name at the bottom of the sidebar. Your sign-in email address cannot be changed from the dashboard.

Your password, your connected sign-in providers, and your active sessions are on the security page alongside it. Revoking a session there is the fastest way to cut off a device you no longer control, and changing your password revokes your other sessions for you.
