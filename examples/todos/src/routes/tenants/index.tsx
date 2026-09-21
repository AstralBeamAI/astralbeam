import { createFileRoute } from "@tanstack/react-router"
import { DirectoriesPage } from "@/components/directories-page.tsx"

export const Route = createFileRoute("/tenants/")({
  component: () => <DirectoriesPage kind="tenants" />,
})
