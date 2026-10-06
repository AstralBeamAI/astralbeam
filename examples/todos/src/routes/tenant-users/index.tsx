import { createFileRoute } from "@tanstack/react-router"
import { UsersPage } from "@/components/users-page.tsx"

export const Route = createFileRoute("/tenant-users/")({
  component: UsersPage,
})
