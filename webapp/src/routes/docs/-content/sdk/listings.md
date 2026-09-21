# Tenant directories

Tenant directories show tenant records and their users inside your application. Let's provision records and embed a read-only user directory for a customer administrator, scoped to their own tenant.

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

<AstralBeamTenantList fetchAstralBeamToken={{ url: "/api/astralbeam/token" }} />
```

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

- React props and vanilla `update()` apply live options. Inline token-source objects and callbacks do not clear the view.
- React refs and vanilla handles expose `refresh()` to reload queries and `reset()` to clear state and immediately reacquire authentication.
- `reset()` requires a ready host session. It is not a pause or sign-out operation.
- Token-source updates take effect on the next acquisition or refresh, not immediately. API URL changes clear authentication and cached rows.
- Changing scope or a pinned tenant clears the view. Changing page size restarts pagination while preserving filters.

## Host callbacks

Let's connect user row actions and terminal request failures to your application:

```tsx
<AstralBeamTenantUserList
  fetchAstralBeamToken={{ url: "/api/astralbeam/token" }}
  onTenantUserSelect={(user) => openUserDetails(user)}
  onError={(error) => reportDirectoryError(error)}
/>
```

`openUserDetails` and `reportDirectoryError` are host functions. Providing `onTenantSelect` or `onTenantUserSelect` adds an Open action. Clicking the name still expands metadata. Callbacks receive API records with snake_case field names.

`onError` reports each failed request after the automatic authentication retry finishes. It includes token-acquisition failures, excludes cancellations and identity-change resets, and preserves the widget's error UI. Use `isAstralBeamApiError` from `/api` to inspect HTTP status and structured problem details. Multiple failed requests can report separately, so deduplicate host notifications if needed. A `403` is a permission failure, not necessarily an expired session.

`onTenantChange` observes actual organization-scope picker changes, returning a Tenant record or `null` when cleared. It does not fire for initial or pinned values and does not make the picker controlled.

## Options and behavior

Directories share chat's `theme` and `colorScheme` options. Reuse the same theme object across widgets. Removing overrides restores the SDK palette without resetting the directory. See [Theming](./theming.md).

| Option                         | Default                         | Purpose                                                                                                                      |
| ------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `fetchAstralBeamToken`         | Required                        | Endpoint `{ url, ...RequestInit }` or function returning `{ token }`. Unlike chat, directories have no default token source. |
| `apiUrl`                       | `https://app.astralbeam.ai/api` | AstralBeam API base. Set your deployment's `/api` URL when self-hosting.                                                     |
| `scope`                        | `"tenant"`                      | Tenant view, or `"organization"` with an organization-management JWT.                                                        |
| `tenantId`, `tenantExternalId` | Signed tenant in tenant scope   | Pin a Tenant by internal UUID or exact external ID. Internal ID takes precedence.                                            |
| `pageSize`                     | `20`                            | Initial page size, one of `20`, `50`, or `100`.                                                                              |
| `title`                        | `"Tenants"` or `"Tenant users"` | Header and accessible region name.                                                                                           |
| `showHeader`                   | `true`                          | Show the directory heading and tenant context.                                                                               |
| `showAdmin`                    | `false`                         | User directory only. Show the stored admin column and filter, without changing permissions.                                  |
| `colorScheme`, `theme`         | `"system"`, SDK palette         | Chat-compatible appearance options.                                                                                          |
| `onTenantSelect`               | None                            | Tenant directory's Open action.                                                                                              |
| `onTenantUserSelect`           | None                            | User directory's Open action.                                                                                                |
| `onTenantChange`               | None                            | User directory's organization-scope picker changes.                                                                          |
| `onError`                      | None                            | Failed requests after authentication retry, excluding cancellations.                                                         |

- Previous/Next follow server cursors, with no estimated totals or client-side sorting.
- Search is debounced and matches literal text in names or external IDs. Collections use server-side search, while an explicitly selected single Tenant is filtered locally. Filters reset the current page.
- Hiding stored admin fields removes any active admin filter.
- Rows show external IDs under **ID**, names, metadata previews, and creation dates. Expand a name for full metadata. Internal UUIDs are not displayed.
- Tokens refresh once on HTTP `401`. Other failures offer explicit retry.

**NOTE**: For uncommon internal-management use cases, both components also support `scope="organization"` with an [organization-management token](./api.md). The user directory then offers a searchable Tenant picker. Set `tenantId` or `tenantExternalId` to pin one Tenant, or when using that token with tenant scope. Tokens retain their delegated permissions even though the UI is read-only.

## Troubleshooting

- An empty directory can mean no persisted records or no search matches. Tokens never create or synchronize records. Check provisioning first, then clear filters.
- A `403` means the token lacks permission. Tenant views require signed tenant-admin authority.
- A missing tenant shows an empty state. Check the token and record's external IDs for exact spelling and case.
- Stored admin controls are hidden intentionally. Enable `showAdmin` only when the attribute is useful to your audience.
