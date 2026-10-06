import { createFileRoute } from "@tanstack/react-router"
import { DirectoryPage } from "@/components/directory-page.tsx"

export const Route = createFileRoute("/tenant-users/")({
  component: () => <DirectoryPage />,
})
