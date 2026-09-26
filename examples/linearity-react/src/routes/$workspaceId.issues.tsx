import { createFileRoute } from "@tanstack/react-router"
import { WorkspaceView } from "@/components/workspace-view.tsx"
export const Route = createFileRoute("/$workspaceId/issues")({
  component: () => <WorkspaceView view="Issues" />,
})
