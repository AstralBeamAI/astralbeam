# Directories

Directories show tenants, their users and saved conversations inside your application. Let's provision records and embed a read-only user directory for a customer administrator, scoped to their own tenant.

## From records to a working directory

1. Create the Tenant and TenantUser records from your server. Your Organization API key stays server-side. Keep the returned UUIDs for subsequent updates.

   Let's create a customer and one of its users:

   ```ts
   import { createTenant, createTenantUser } from "@astralbeam/sdk/api"

   const auth = { apiKey: organizationApiKey }
   const tenant = await createTenant({ external_id: "northwind", name: "Northwind Traders" }, auth)
   await createTenantUser(
     tenant.id,
     {
       external_id: "nancy",
       name: "Nancy",
       metadata: { department: "Support" },
     },
     auth,
   )
   ```

   These are create operations, not upserts. For repeatable synchronization, look up exact external IDs with `filter[external_id]`, then create or update using the returned UUIDs. If concurrent creation returns `409`, look up the existing record. See the [API client guide](./api.md).

2. Authenticate the customer administrator in your host application before minting a token. Your authentication adapter must verify that this user is an administrator of the selected customer and reject unauthorized requests.

   Let's connect that host-owned adapter to `/api/astralbeam/token`:

   ```ts
   import { createAstralBeamToken } from "@astralbeam/sdk/server"
   import { requireCustomerAdmin } from "./auth"

   export async function POST(request: Request) {
     const headers = { "Cache-Control": "no-store" }
     const session = await requireCustomerAdmin(request)
     try {
       const token = await createAstralBeamToken({
         apiKey: organizationApiKey,
         tenant: { id: session.tenant.externalId },
         user: { id: session.user.externalId, admin: true },
       })
       return Response.json({ token }, { headers })
     } catch {
       return Response.json({ error: "Token could not be issued" }, { status: 500, headers })
     }
   }
   ```

   `requireCustomerAdmin` and `organizationApiKey` belong to your application, not the SDK. The external IDs must match step 1. Map authentication failures to `401` or `403` in your host framework and never return signing errors or credentials. See [authentication](./authentication.md) for token endpoint requirements.

3. Embed the directory. Tenant scope is the default, and the SDK resolves the signed Tenant identity to its persisted record.

   Let's render it without installing Tailwind or providing a Query client:

   ```tsx
   import { AstralBeamTenantUserList } from "@astralbeam/sdk/react"

   const tokenSource = { url: "/api/astralbeam/token" }

   export function CustomerUsers() {
     return <AstralBeamTenantUserList fetchAstralBeamToken={tokenSource} />
   }
   ```

**NOTE**: The widget is read-only, but its signed tenant-admin JWT permits reading the Tenant and reading and writing its TenantUsers through the API. Stored `admin` is informational, not an authorization source.

## Mount in React

Use `AstralBeamTenantUserList` for a tenant's users. `AstralBeamTenantList` shows Tenant records, limited to the signed tenant by default.

Let's render the current tenant's record in React:

```tsx
import { AstralBeamTenantList } from "@astralbeam/sdk/react"

;<AstralBeamTenantList fetchAstralBeamToken={{ url: "/api/astralbeam/token" }} />
```

**NOTE**: React refs now expose only `refresh()` and `reset()`. Import `AstralBeamTenantListRef`, `AstralBeamTenantUserListRef`, or `AstralBeamThreadListRef` from `/react` instead of the former `*ListHandle` types, whose `/react` exports have been removed. Replace ref `update()` calls with props and ref `unmount()` calls with conditional rendering. Vanilla handles from `/client` retain both methods.

## Mount anywhere else

`mountAstralBeamTenantUserList` takes a target element and options, and returns a handle.

Let's mount the user directory and update its appearance:

```ts
import { mountAstralBeamTenantUserList } from "@astralbeam/sdk/client"

const handle = mountAstralBeamTenantUserList(document.getElementById("users")!, {
  fetchAstralBeamToken: { url: "/api/astralbeam/token" },
})
handle.update({ colorScheme: "dark" })
handle.unmount()
```

Use `mountAstralBeamTenantList` from the same entry point for Tenant records. The directory loads lazily with its own bundled React.

## Tenant identifiers

Tenant-scoped embeds resolve the Tenant from the signed token automatically. If you supply `tenantExternalId`, matching is exact and case-sensitive, with whitespace preserved. `tenantId` is the internal UUID and takes precedence if both options are supplied. A missing external ID shows an empty state, never another Tenant's records. View options never grant authorization.

## Account changes and lifecycle

Unmount before sign-out or a user or tenant switch, even if the token endpoint URL stays the same. Render the new directory only after the host session is ready.

Let's make the authenticated identity control the React lifecycle:

```tsx
import { AstralBeamTenantUserList } from "@astralbeam/sdk/react"

const tokenSource = { url: "/api/astralbeam/token" }

export function CustomerUsers({ accountId }: { accountId: string | null }) {
  if (accountId === null) return null
  return <AstralBeamTenantUserList key={accountId} fetchAstralBeamToken={tokenSource} />
}
```

Use an `accountId` that changes with either the signed-in user or tenant, and set it to `null` during transitions. Vanilla hosts call `unmount()` instead.

Directory results stay fresh for 30 seconds, then refresh in the background when the tab becomes visible or the network reconnects. Unused data expires after five minutes.

`cacheKey` is an optional opaque object defining the host-session boundary for remount reuse. The SDK uses its object identity, so keep the same object for the session and replace it on sign-out or account changes. Changing `cacheKey` clears authentication and the view. Without a key, unmounting discards the directory's data. Reuse also requires the same verified account and API.

Each mount authenticates independently and owns its requests and cancellation. Concurrent mounts keep separate data, do not deduplicate requests, and do not refresh each other. For each directory kind and scope under the same key, the last unmounted directory replaces the data retained for a later mount. `cacheKey` does not create a shared live session.

`refresh()` and `reset()` both return `Promise<void>`. Calls made before the lazy renderer is ready wait for it. They resolve after authentication and the enabled directory data requests complete, including the current rows or open conversation messages. They do not wait for attachment previews, hidden views, or pages that have not been requested.

Let's wait for a directory to show a completed write before finishing the host workflow:

```ts
await saveChanges()
await handle.refresh()
finishEditing()
```

`saveChanges` and `finishEditing` belong to your application. React callers await the ref's `refresh()` action. Await or handle rejection from both actions, including calls that previously returned `void`.

- React props and vanilla `update()` apply live options. Inline token-source objects and callbacks do not clear the view.
- `refresh()` reloads the current view and may reuse the cached JWT. Token-source updates apply on the next token acquisition.
- `reset()` clears this mount's authentication, cached data, and view state, along with retained data for its `cacheKey`, then reacquires authentication and loads the initial view. Active sibling mounts remain independent. Reset requires a ready host session. Unmount for sign-out or while the host session changes.
- API URL changes clear authentication and cached data.
- Changing scope or a pinned tenant clears the view. Changing page size restarts pagination while preserving filters.

Loading, authentication, and request failures reject the action's promise. Request and authentication failures also reach the existing `onError` callback once per failed request or shared authentication attempt. A newer action, unmount, verified identity change, or change to `apiUrl`, `cacheKey`, `scope`, or the pinned tenant interrupts the pending action with `AbortError`, without calling `onError`.

## Browse saved conversations

Conversation directories let administrators review saved conversations and uploads. Let's embed a Tenant-scoped directory with the same trusted administrator token source:

```tsx
import { AstralBeamThreadList } from "@astralbeam/sdk/react"

;<AstralBeamThreadList fetchAstralBeamToken={{ url: "/api/astralbeam/token" }} />
```

For a vanilla application, let's mount the same directory:

```ts
import { mountAstralBeamThreadList } from "@astralbeam/sdk/client"

const handle = mountAstralBeamThreadList(element, {
  fetchAstralBeamToken: { url: "/api/astralbeam/token" },
})
```

- Rows show participants, conversation titles and last activity. Participant names fall back to external IDs.
- Search matches literal title text, ordered by last activity. Open a title to read metadata, saved messages and uploads, load earlier messages, or refresh the saved view.
- Tools and widgets show stored information without repeating actions or accepting answers. Partial output does not confirm that generation is running. Administrative reads grant no participant permissions.
- Organization scope requires a selected Tenant, like the user directory. Clearing it clears the list. Use `tenantId` or `tenantExternalId` to pin a Tenant.

**NOTE**: Use the same options and lifecycle actions as the other directories, with signed Tenant-admin authority or an Organization-management token with current read permission.

## Host callbacks

Let's connect user row actions and terminal request failures to your application:

```tsx
<AstralBeamTenantUserList
  fetchAstralBeamToken={{ url: "/api/astralbeam/token" }}
  onTenantUserSelect={(user) => openUserDetails(user)}
  onError={(error) => reportDirectoryError(error)}
/>
```

`openUserDetails` and `reportDirectoryError` are host functions. Providing `onTenantSelect` or `onTenantUserSelect` adds an Open action. Callbacks receive API records with snake_case field names.

`onError` reports each failed request after the automatic authentication retry finishes. It includes initial and background authentication failures, excludes cancellations and identity-change resets, and preserves the widget's error UI. Shared authentication failures report once, including when several requests are waiting. Use `isAstralBeamApiError` from `/api` to inspect HTTP status and structured problem details. Multiple failed requests can report separately, so deduplicate host notifications if needed. A `403` is a permission failure, not necessarily an expired session.

`onTenantChange` observes actual organization-scope picker changes, returning a Tenant record or `null` when cleared. It does not fire for initial or pinned values and does not make the picker controlled.

## Options and behavior

Directories share chat's `theme` and `colorScheme` options. Reuse the same theme object across widgets. Removing overrides restores the SDK palette without resetting the directory. See [Theming](./theming.md).

Because directories render inside a Shadow DOM, host styles and React `className` only affect the outer container. Let's pass application-owned CSS through `customCss` to customize the contents:

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

`customCss` is ordinary CSS, not uncompiled Tailwind classes. It applies only inside this widget. Changing or removing it updates styles without resetting filters, pagination, or authentication. Use `handle.update({ customCss })` with vanilla mounts, or change the React prop. Pass only trusted application CSS, never user-supplied content.

Conversation views also expose `directory-transcript`. The directory styling slots are `directory`, `directory-header`, `directory-toolbar`, `directory-page-controls`, `directory-tenant-picker`, `directory-tenant-label`, `directory-empty`, `directory-page`, `directory-pagination`, and `directory-avatar`. Shared control slots include `input`, `input-group`, `native-select`, `button`, `combobox-content`, `alert`, `table-container`, `table`, `table-head`, and `table-cell`. Select them with `[data-slot="..."]`. Prefer `theme` for colors and fonts, and `customCss` for layout, spacing, focus treatment, and component sizing.

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

Organization owners and developers see **Usage (USD)** in the user directory, independently of `showAdmin`. Usage loads separately, so users and pagination remain available while costs load or fail. Choose this month, previous month, this week, previous week, last 30 days, or last 7 days. Calendar periods use UTC, with weeks running Monday through Sunday. Rolling periods end when fetched and span exactly 30 or 7 days. The current month is the default. Changing the period reloads only usage and preserves the directory state. Results are reused for 30 seconds, and Refresh reloads both users and usage with a new rolling cutoff. Viewers and Tenant administrators do not request usage.

Usage is estimated from retained assistant messages, preferring saved provider-reported cost and otherwise using current configured rates. Users without retained assistant messages have zero usage. Missing message usage or pricing appears as **Unavailable**. Deleted conversations are excluded. Server integrations can use `getTenantUserUsage` with an Organization API key, a comma-separated `user_ids` list, and ISO 8601 `start` and `end` timestamps with an explicit timezone, such as `2026-10-01T00:00:00.000Z`. The start is inclusive and the end is exclusive. Requests support up to 100 users and any positive time range no longer than 93 days, with millisecond precision.

**NOTE**: For uncommon internal-management use cases, all three directories also support `scope="organization"` with an [organization-management token](./api.md). The user directory then offers a searchable Tenant picker. Set `tenantId` or `tenantExternalId` to pin one Tenant, or when using that token with tenant scope. Tokens retain their delegated permissions even though the UI is read-only.

## Troubleshooting

- An empty directory can mean no persisted records or no search matches. The SDK synchronizes a tenant JWT's own Tenant and TenantUser through `/me`. Other users appear after their own synchronization or a management API import. Check provisioning first, then clear filters.
- A `403` means the token lacks permission. Tenant views require signed tenant-admin authority.
- A missing tenant shows an empty state. Check the token and record's external IDs for exact spelling and case.
- Stored admin controls are hidden intentionally. Enable `showAdmin` only when the attribute is useful to your audience.
