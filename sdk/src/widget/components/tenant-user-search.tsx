import { TenantUserLabel, tenantUserIdentifier } from "./tenant-user-label.tsx"
import { SearchDropdown } from "./search-dropdown.tsx"

export interface TenantUserChoice {
  id: string
  name: string | null
  external_id: string
  email: string | null
}

export function TenantUserSearch({
  loadPage,
  value,
  onValueChange,
  disabled = false,
}: {
  loadPage: (
    q: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<{
    items: TenantUserChoice[]
    page_after: string | null
  }>
  value: TenantUserChoice | null
  onValueChange: (user: TenantUserChoice | null) => void
  disabled?: boolean
}) {
  return (
    <SearchDropdown
      label="Tenant user"
      placeholder="Search name, email, or user ID…"
      loadPage={loadPage}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      clearOnSearch
      itemLabel={(user) => user.name || user.email || tenantUserIdentifier(user.external_id)}
      renderItem={(user) => (
        <TenantUserLabel name={user.name} externalId={user.external_id} email={user.email} />
      )}
    />
  )
}
