# Tenant directories

Tenant directories show your customers and their users inside your application. Let's provision records, connect an authenticated token endpoint, and embed a read-only directory with isolated styles.

## From records to a working directory

1. Create the Tenant and TenantUser records from your server. Your Organization API key stays server-side. Keep the returned UUIDs for subsequent updates.

   Let's create a customer and one of its users:

   ```ts
   import { createTenant, createTenantUser } from "@astralbeam/sdk/api"

   const auth = { apiKey: organizationApiKey }
   const tenant = await createTenant({ external_id: "northwind", name: "Northwind Traders" }, auth)
   await createTenantUser(tenant.id, {
     external_id: "nancy",
     name: "Nancy",
     metadata: { department: "Support" },
   }, auth)
   ```

   These are create operations, not upserts. For repeatable synchronization, look up exact external IDs with `filter[external_id]`, then create or update using the returned UUIDs. If concurrent creation returns `409`, look up the existing record. See the [API client guide](./api.md).

2. Authenticate the customer administrator in your host application before minting a token. Your authentication adapter must verify that this user is an administrator of the selected customer and reject unauthorized requests.

   Let's connect that host-owned adapter to `/api/astralbeam/token`:

   ```ts
   import { createAstralBeamToken } from "@astralbeam/sdk/server"
   import { requireCustomerAdmin } from "./auth"

   export async function POST(request: Request) {
     const session = await requireCustomerAdmin(request)
     const token = await createAstralBeamToken({
       apiKey: organizationApiKey,
       tenant: { id: session.tenant.externalId },
       user: { id: session.user.externalId, admin: true },
     })
     return Response.json({ token }, { headers: { "Cache-Control": "no-store" } })
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

4. Remove the directory while the host signs out or changes accounts, before the new identity can reuse the screen. In React, use your authenticated account identity as a key and render nothing during the transition. Vanilla handles expose `unmount()` when removing the screen.

   Let's make the host's account state control the directory lifecycle:

   ```tsx
   import { AstralBeamTenantUserList } from "@astralbeam/sdk/react"

   const tokenSource = { url: "/api/astralbeam/token" }

   export function CustomerUsers({ accountId }: { accountId: string | null }) {
     if (accountId === null) return null
     return <AstralBeamTenantUserList key={accountId} fetchAstralBeamToken={tokenSource} />
   }
   ```

   Set `accountId` to `null` while switching, then supply the new account identity after authentication completes. For an in-place reload after the host session is ready, React refs and vanilla handles also expose `reset()`.

**NOTE**: Authentication never creates or synchronizes directory records. Stored `admin` is an informational attribute. The signed `user.admin` claim grants tenant-admin authority, and must come from your host's authorization decision.

## Tenant administrator view

Use your existing host token endpoint, returning a tenant JWT with signed `user.admin: true`. Tenant scope is the default.

```ts
import { mountAstralBeamTenantUserList } from "@astralbeam/sdk/client"

const directory = mountAstralBeamTenantUserList(document.getElementById("users")!, {
  fetchAstralBeamToken: { url: "/api/astralbeam/token" },
})

// On sign-out, account transition, or removal of the host screen:
directory.unmount()
```

Mount a new directory after the host session is ready. `reset()` clears state and immediately reloads using the current token source, so it is not a pause or sign-out operation.

The widget resolves the signed external Tenant identity to its persisted internal UUID. Missing Tenants show an empty state. Authentication does not create Tenants or TenantUsers.

## Tenant identifiers

Tenant-scoped embeds resolve the Tenant from the signed token automatically. If you supply `tenantExternalId`, matching is exact and case-sensitive, with whitespace preserved. `tenantId` is the internal UUID and takes precedence if both options are supplied. A missing external ID shows an empty state, never another Tenant's records. View options never grant authorization.

## React

Like chat, the React wrappers keep one mounted instance and apply live options. Inline token-source objects and callbacks do not clear the directory. The latest token source is used when authentication is next acquired or refreshed. Unmount during host identity transitions, even if the token endpoint URL stays the same. Use `reset()` only after the host session is ready.

### Host callbacks

Let's connect user row actions and terminal request failures to your application:

```tsx
<AstralBeamTenantUserList
  fetchAstralBeamToken={{ url: "/api/astralbeam/token" }}
  onTenantUserSelect={(user) => openUserDetails(user)}
  onError={(error) => reportDirectoryError(error)}
/>
```

`openUserDetails` and `reportDirectoryError` are host functions. Use `onTenantSelect` and `onTenantUserSelect` for row actions. `onTenantChange` observes actual picker changes, receiving the selected record or `null` when cleared. It does not fire for initial values, rerenders, or pinned Tenant options.

`onError` reports each failed request after the automatic authentication retry finishes. It includes token-acquisition failures, excludes cancellations and identity-change resets, and preserves the widget's error UI. Use `isAstralBeamApiError` from `/api` to inspect HTTP status and structured problem details. Multiple failed requests can report separately, so deduplicate host notifications if needed. A `403` is a permission failure, not necessarily an expired session.

**NOTE**: `onTenantChange` observes selection. It does not make the picker controlled. Passing `tenantId` still pins the view and hides the picker.

## Other frameworks

The `/client` mount functions work with DOM elements in Vue, Svelte, Angular, or plain JavaScript. Mount after the element exists, apply changes with `update()`, and call `unmount()` when your framework removes it. The styled widget bundles its own React internally. Your application does not need to install React.

## Options and behavior

Directories use the same `theme` and `colorScheme` options as chat. Pass the same theme object to all three components to share backgrounds, text, primary actions, borders, muted surfaces, popovers, and fonts. `theme.light` supplies the base overrides, with `theme.dark` layered on in dark mode. Removing overrides restores the SDK palette without resetting the directory.

- Common options: `apiUrl`, `fetchAstralBeamToken`, `scope`, `tenantId`, `tenantExternalId`, `pageSize`, `title`, `showHeader`, `colorScheme`, `theme`, and `onError`.
- `pageSize` is 20, 50, or 100. Previous/Next follow opaque cursors, with no estimated totals or client-side sorting.
- Search is debounced and matches literal text in names or external IDs. Collections use server-side search, while an explicitly selected single Tenant is filtered locally. Filters reset the current page.
- TenantUser directories hide stored admin fields by default. Set `showAdmin` to show the column and filter. This changes presentation, not authorization or API data access.
- Rows show names, external IDs, a compact metadata preview, and the creation date. Expand a row for full metadata. `onTenantSelect` and `onTenantUserSelect` handle row actions, while `onTenantChange` observes the user directory's picker.
- `update()` applies options, `refresh()` reloads queries, `reset()` clears state and reloads the ready host session, and `unmount()` aborts work and removes UI.

Identity resets and API URL changes clear authentication and cached rows. Token-source and callback updates preserve authentication and the view. Scope, internal Tenant ID, and external Tenant ID changes clear the view but retain authentication. Page-size changes restart pagination while preserving filters and authentication. Hiding admin fields removes any active admin filter. Tokens refresh once on HTTP 401. Other failures offer explicit retry. Callbacks receive generated API records with snake_case field names.

**NOTE**: For uncommon internal-management use cases, both components also support `scope="organization"` with an [organization-management token](./api.md). The user directory then offers a searchable Tenant picker. Set `tenantId` or `tenantExternalId` to pin one Tenant, or when using that token with tenant scope. Tokens retain their delegated permissions even though the UI is read-only.

## Troubleshooting

- An empty directory can mean no persisted records or no search matches. Check provisioning first, then clear the filters.
- A `403` means the token lacks permission. Tenant views require signed tenant-admin authority.
- A tenant lookup does not create records. Check exact spelling and case when using external IDs.
- Stored admin controls are hidden intentionally. Enable `showAdmin` only when the attribute is useful to your audience.

The widgets use [TanStack Table](https://tanstack.com/table/latest/docs/guide/client-side-vs-server-side) with [shadcn Base UI primitives](https://ui.shadcn.com/docs/components/base/data-table). Pagination caps rendering at 100 records, so virtualization is unnecessary.
