import { createFileRoute } from "@tanstack/react-router"
import { WorkspaceView } from "@/components/workspace-view.tsx"
export const Route = createFileRoute("/$workspaceId/overview")({
  component: () => <WorkspaceView view="Overview" />,
})
