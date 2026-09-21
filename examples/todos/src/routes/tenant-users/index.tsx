import { createFileRoute } from "@tanstack/react-router"
import { TenantUsersPage } from "@/components/tenant-users-page.tsx"

export const Route = createFileRoute("/tenant-users/")({
  component: TenantUsersPage,
})
