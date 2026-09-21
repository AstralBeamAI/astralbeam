import { createFileRoute } from "@tanstack/react-router"
import { DirectoriesPage } from "@/components/directories-page.tsx"

export const Route = createFileRoute("/tenant-users/")({
  validateSearch: (search): { tenantExternalId?: string } =>
    typeof search.tenantExternalId === "string"
      ? { tenantExternalId: search.tenantExternalId }
      : {},
  component: TenantUsersPage,
})

function TenantUsersPage() {
  const { tenantExternalId } = Route.useSearch()
  return <DirectoriesPage kind="users" tenantExternalId={tenantExternalId} />
}
