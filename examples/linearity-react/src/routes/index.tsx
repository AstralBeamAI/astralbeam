import { createFileRoute, Navigate } from "@tanstack/react-router"
import { useDemo } from "@/lib/store.ts"

export const Route = createFileRoute("/")({ component: Home })
function Home() {
  const { data, ready } = useDemo()
  if (!ready) return <div className="app-loading">Opening your workspace…</div>
  return (
    <Navigate
      to="/$workspaceId/overview"
      params={{ workspaceId: data.activeWorkspaceId }}
      replace
    />
  )
}
