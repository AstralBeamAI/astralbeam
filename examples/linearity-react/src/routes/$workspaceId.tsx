import { createFileRoute, notFound } from "@tanstack/react-router"
import { Linearity } from "@/components/linearity.tsx"
import { demoWorkspaces } from "@/lib/model.ts"
import { searchSchema } from "@/lib/navigation.ts"

export const Route = createFileRoute("/$workspaceId")({
  validateSearch: searchSchema.catch({}),
  beforeLoad: ({ params }) => {
    if (!demoWorkspaces.some((workspace) => workspace.id === params.workspaceId)) throw notFound()
  },
  component: Linearity,
})
