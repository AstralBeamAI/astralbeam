# Directories

Embed directories of customers, users, and saved conversations in your application. The example below gives a customer administrator a read-only user directory scoped to their Tenant.

## From records to a working directory

1. Provision users through the [management API](./api.md), or let their first SDK session synchronize their own record.
2. In your authenticated token endpoint, verify that the signed-in user is an administrator of the selected customer. Add `admin: true` to the signed user:

   ```ts
   const token = await createAstralBeamToken({
     apiKey,
     tenant: { id: session.tenant.id },
     user: { id: session.user.id, admin: true },
   })
   ```

3. Mount the directory using that endpoint, as shown below.

**NOTE**: The widget is read-only. Its tenant-admin token permits API writes to TenantUsers. Stored `admin` does not grant this authority.

Sign in and confirm the expected users appear. Check another customer account to verify tenant isolation.

## Mount the directory

Use `AstralBeamTenantUserList` for users or `AstralBeamTenantList` for Tenant records. No Tailwind setup or Query client is required.

<!-- ::start:tabs variant="files" -->

```tsx title="React"
import { AstralBeamTenantUserList } from "@astralbeam/sdk/react"

;<AstralBeamTenantUserList fetchAstralBeamToken={{ url: "/api/astralbeam/token" }} />
```

```js title="JavaScript"
import { mountAstralBeamTenantUserList } from "@astralbeam/sdk/client"

const directory = mountAstralBeamTenantUserList(document.getElementById("users"), {
  fetchAstralBeamToken: { url: "/api/astralbeam/token" },
})

// When removing the container, call directory.unmount().
```

<!-- ::end:tabs -->

React refs expose `refresh()` and `reset()`. Import the matching `AstralBeamTenantListRef`, `AstralBeamTenantUserListRef`, or `AstralBeamThreadListRef` from `/react`. JavaScript handles also expose `update()` and `unmount()`.

## Tenant identifiers

Tenant-scoped embeds resolve the Tenant from the signed token automatically. If you supply `tenantExternalId`, matching is exact and case-sensitive, with whitespace preserved. `tenantId` is the internal UUID and takes precedence if both options are supplied. A missing external ID shows an empty state, never another Tenant's records. View options never grant authorization.

## Account changes and lifecycle

Unmount before sign-out or a user or tenant switch, even if the token endpoint URL stays the same. Render the new directory only after the host session is ready.

Key the React component by the authenticated account:

```tsx
import { AstralBeamTenantUserList } from "@astralbeam/sdk/react"

const tokenSource = { url: "/api/astralbeam/token" }

export function CustomerUsers({ accountId }: { accountId: string | null }) {
  if (accountId === null) return null
  return <AstralBeamTenantUserList key={accountId} fetchAstralBeamToken={tokenSource} />
}
```

Use an `accountId` that changes with either the signed-in user or tenant, and set it to `null` during transitions. Vanilla hosts call `unmount()` instead.

### Cache reuse

Results stay fresh for 30 seconds, then refresh in the background on focus or reconnect. Unused data expires after five minutes.

`cacheKey` is an optional opaque object defining the host-session boundary for remount reuse. The SDK uses its object identity, so keep the same object for the session and replace it on sign-out or account changes. Changing `cacheKey` clears authentication and the view. Without a key, unmounting discards the directory's data. Reuse also requires the same verified account and API.

Each mount owns authentication, requests, and cancellation. Concurrent mounts keep separate data and do not deduplicate or refresh each other. For each directory kind and scope under a key, the last unmount replaces retained data. `cacheKey` enables remount reuse, not a shared live session.

### Refresh and reset

`refresh()` and `reset()` return `Promise<void>` after authentication and the current view's data finish loading. They wait for the lazy renderer, but not attachment previews, hidden views, or unrequested pages. Await the action before closing a host editor and handle rejection.

- React props and vanilla `update()` apply live options. Inline token-source objects and callbacks do not clear the view.
- `refresh()` reloads the current view and may reuse the cached JWT. Token-source updates apply on the next token acquisition.
- `reset()` clears this mount's authentication, cached data, and view state, along with retained data for its `cacheKey`, then reacquires authentication and loads the initial view. Active sibling mounts remain independent. Reset requires a ready host session. Unmount for sign-out or while the host session changes.
- API URL changes clear authentication and cached data.
- Changing scope or a pinned tenant clears the view. Changing page size restarts pagination while preserving filters.

Loading, authentication, and request failures reject the action's promise. Request and authentication failures also reach the existing `onError` callback once per failed request or shared authentication attempt. A newer action, unmount, verified identity change, or change to `apiUrl`, `cacheKey`, `scope`, or the pinned tenant interrupts the pending action with `AbortError`, without calling `onError`.

## Browse saved conversations

Use the same administrator token source for saved conversations and uploads:

<!-- ::start:tabs variant="files" -->

```tsx title="React"
import { AstralBeamThreadList } from "@astralbeam/sdk/react"

;<AstralBeamThreadList fetchAstralBeamToken={{ url: "/api/astralbeam/token" }} />
```

```js title="JavaScript"
import { mountAstralBeamThreadList } from "@astralbeam/sdk/client"

const directory = mountAstralBeamThreadList(element, {
  fetchAstralBeamToken: { url: "/api/astralbeam/token" },
})
```

<!-- ::end:tabs -->

Search titles and open a conversation to read saved messages and uploads. History never repeats tool actions or accepts widget answers, and administrative reads grant no participant permissions. Partial output does not prove generation is still running.

In organization scope, select or pin a Tenant. The component uses the same options and lifecycle as the other directories.

## Host callbacks

Connect row actions and errors to your application:

```tsx
<AstralBeamTenantUserList
  fetchAstralBeamToken={{ url: "/api/astralbeam/token" }}
  onTenantUserSelect={(user) => openUserDetails(user)}
  onError={(error) => reportDirectoryError(error)}
/>
```

`onTenantSelect` and `onTenantUserSelect` add an Open action and receive API records with snake_case fields.

`onError` reports failed requests after authentication retry, including background failures, without replacing the widget's error UI. Cancellations are excluded and shared authentication failures report once. Separate failed requests can each report an error. Use `isAstralBeamApiError` from `/api` for status and problem details.

`onTenantChange` reports organization-scope picker changes as a Tenant or `null`. It does not fire for initial or pinned values and does not make the picker controlled.

## Options and behavior

Directories share chat's `theme` and `colorScheme` options. Reuse the same theme object across widgets. Removing overrides restores the SDK palette without resetting the directory. See [Theming](./theming.md).

Host styles and React `className` affect only the outer container. Use `customCss` for styles inside the shadow root:

```tsx
<AstralBeamTenantList
  fetchAstralBeamToken={{ url: "/api/astralbeam/token" }}
  customCss={`
    [data-slot="directory"] { gap: 1.5rem; }
    [data-slot="directory-toolbar"] { padding: 0.5rem; }
    [data-slot="table"] { font-size: 0.75rem; }
  `}
/>
```

`customCss` is ordinary CSS, not uncompiled Tailwind classes. It applies only inside this widget. Changing or removing it updates styles without resetting filters, pagination, or authentication. Use `directory.update({ customCss })` with vanilla mounts, or change the React prop. Pass only trusted application CSS, never user-supplied content.

Conversation views also expose `directory-transcript`. Use `[data-slot="directory"]`, `[data-slot="directory-toolbar"]`, and the shared control slots shown above. The [directory renderer](https://github.com/AstralBeamAI/astralbeam/blob/main/sdk/src/widget/listings/listing-widget.tsx) contains the full slot names. Prefer `theme` for colors and fonts.

| Option | Default | Purpose |
| --- | --- | --- |
| `fetchAstralBeamToken` | Required | Endpoint `{ url, ...RequestInit }` or function returning `{ token }`. Unlike chat, directories have no default token source. |
| `apiUrl` | `https://astralbeam.ai/api` | AstralBeam API base. Set your deployment's `/api` URL when self-hosting. |
| `cacheKey` | None | Opaque host-session object for remount reuse. Changing its identity clears authentication and the view. Replace it on sign-out or account changes. |
| `scope` | `"tenant"` | Tenant view, or `"organization"` with an organization-management JWT. |
| `tenantId`, `tenantExternalId` | Signed tenant in tenant scope | Pin a Tenant by internal UUID or exact external ID. Internal ID takes precedence. |
| `pageSize` | `20` | Initial page size, one of `20`, `50`, or `100`. |
| `title` | `"Tenants"`, `"Tenant users"` or `"Conversations"` | Header and accessible region name. |
| `showHeader` | `true` | Show the directory heading and tenant context. |
| `customCss` | None | Trusted CSS inside the widget's Shadow DOM. Omit to retain SDK styles. |
| `showAdmin` | `false` | User directory only. Show the stored admin column and filter, without changing permissions. |
| `colorScheme`, `theme` | `"system"`, SDK palette | Chat-compatible appearance options. |
| `onTenantSelect` | None | Tenant directory's Open action. |
| `onTenantUserSelect` | None | User directory's Open action. |
| `onTenantChange` | None | User or conversation directory's organization-scope picker changes. |
| `onError` | None | Failed requests after authentication retry, excluding cancellations. |

- Previous/Next follow server cursors, with no estimated totals or client-side sorting.
- Search is debounced and matches literal text in names or external IDs. Collections use server-side search, while an explicitly selected single Tenant is filtered locally. Filters reset the current page.
- Hiding stored admin fields removes any active admin filter.
- Rows show external IDs under **ID**, names, metadata, and creation dates. Names do not expand rows. Internal UUIDs are not displayed.
- Tokens refresh once on HTTP `401`. Other failures offer explicit retry.

**NOTE**: For internal-management use cases, all three directories support `scope="organization"` with an [organization-management token](./api.md). User and conversation directories require a selected Tenant. Use the searchable picker or pin `tenantId` or `tenantExternalId`. When using that token with tenant scope, pin the Tenant explicitly. The read-only UI does not reduce token permissions.

## Usage costs

Organization owners and developers see **Usage (USD)** in the user directory, independently of `showAdmin`. Viewers and Tenant administrators do not request usage. Costs load separately, so failures do not block rows or pagination.

Choose this month, previous month, this week, previous week, last 30 days, or last 7 days. Calendar periods use UTC and Monday-to-Sunday weeks. Rolling periods end when fetched and span exactly 30 or 7 days. The current month is the default.

Changing periods reloads only costs. Results are reused for 30 seconds. Refresh reloads users and costs with a new rolling cutoff.

Totals include retained settled assistant replies. New replies save their resolved USD cost, preferring the provider-reported amount over configured token prices. Older replies without a saved cost use current rates and can change after price updates. Drafts and deleted conversations are excluded. Missing usage or pricing currently contributes $0, including interrupted replies with unknown costs. Users without settled replies show zero.

Amounts show precise values without trailing zeros. A failed request shows **Unavailable** with Retry.

Server integrations can use `getTenantUserUsage` with an Organization API key, comma-separated `user_ids`, and ISO 8601 `start` and `end` timestamps with an explicit timezone. The start is inclusive and the end exclusive. Requests accept up to 100 users and a positive range of at most 93 days, with millisecond precision.

## Troubleshooting

- An empty directory can mean no persisted records or no search matches. The SDK synchronizes a tenant JWT's own Tenant and TenantUser through `/me`. Other users appear after their own synchronization or a management API import. Check provisioning first, then clear filters.
- A `403` means the token lacks permission. Tenant views require signed tenant-admin authority.
- A missing tenant shows an empty state. Check the token and record's external IDs for exact spelling and case.
- Stored admin controls are hidden intentionally. Enable `showAdmin` only when the attribute is useful to your audience.
