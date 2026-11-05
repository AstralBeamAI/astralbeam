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

Tenant-scoped directories use the Tenant from the signed token. To pin one explicitly, use its internal UUID as `tenantId` or its exact, case-sensitive external ID as `tenantExternalId`. `tenantId` takes precedence if both are supplied. A missing Tenant shows an empty state. These options do not grant access.

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

Directories refresh stale results on focus or reconnect. By default, unmounting discards their cached data.

To reuse data across remounts, pass a stable object as `cacheKey` for the host session. Replace that object on sign-out or account changes. Reuse requires the same verified account and API. Each mount still owns its requests and cancellation, so refreshing one does not refresh another.

### Refresh and reset

Call `refresh()` after a host edit to reload the current view. Use `reset()` to clear this mount's authentication, cached data, and view state, then load it again. Reset also clears retained data for its `cacheKey`. Neither action changes active sibling mounts.

Both return `Promise<void>` after authentication and the current view load, excluding attachment previews and unrequested pages. Await them and handle rejection. Account, API, scope, or cache changes can interrupt an action with `AbortError`, which does not call `onError`.

React props and JavaScript `update()` apply live options. Token-source changes take effect on the next acquisition. For sign-out or an account switch, unmount instead of resetting while the host session changes.

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

`onError` reports request and authentication failures, including background failures, while the widget keeps its own error UI. Cancellations are excluded. Use `isAstralBeamApiError` from `@astralbeam/sdk/api` for status and problem details.

`onTenantChange` reports organization-scope picker changes as a Tenant or `null`. It does not fire for initial or pinned values and does not make the picker controlled.

## Options and behavior

Directories use the same `theme`, `colorScheme`, and trusted `customCss` options as chat. Prefer [theme tokens](./theming.md) for colors and fonts. Host styles and React `className` affect the outer container only. For internal CSS selectors, see the [directory renderer](https://github.com/AstralBeamAI/astralbeam/blob/main/sdk/src/widget/listings/listing-widget.tsx).

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

Search matches names and external IDs. Changing filters restarts pagination. Directories renew the token once on `401` and offer explicit retry for other failures.

**NOTE**: For internal-management use cases, all three directories support `scope="organization"` with an [organization-management token](./api.md). User and conversation directories require a selected Tenant. Use the searchable picker or pin `tenantId` or `tenantExternalId`. When using that token with tenant scope, pin the Tenant explicitly. The read-only UI does not reduce token permissions.

## Usage costs

Organization owners and developers see **Usage (USD)** in the user directory. Viewers and Tenant administrators do not. Costs load separately, so an unavailable total does not prevent browsing users.

The default period is this month. Calendar periods use UTC, with weeks running Monday through Sunday. Rolling periods cover the preceding 7 or 30 days at fetch time.

Totals cover retained, settled assistant replies. They prefer provider-reported costs, then configured token prices. Older replies without a saved cost use current prices, so their totals can change. Deleted conversations and drafts are excluded. Missing usage or pricing contributes $0, so the display is not a billing ledger.

For server-side reports, use `getTenantUserUsage` with an Organization API key. See the [API reference](/docs/api) for user filters and time-range limits.

## Troubleshooting

- An empty directory can mean no persisted records or no search matches. The SDK synchronizes a tenant JWT's own Tenant and TenantUser through `/me`. Other users appear after their own synchronization or a management API import. Check provisioning first, then clear filters.
- A `403` means the token lacks permission. Tenant views require signed tenant-admin authority.
- A missing tenant shows an empty state. Check the token and record's external IDs for exact spelling and case.
- Stored admin controls are hidden intentionally. Enable `showAdmin` only when the attribute is useful to your audience.
