import { createFileRoute, Navigate } from "@tanstack/react-router"
export const Route = createFileRoute("/$workspaceId/")({ component: WorkspaceHome })
function WorkspaceHome() {
  const { workspaceId } = Route.useParams()
  return <Navigate to="/$workspaceId/issues" params={{ workspaceId }} replace />
}
