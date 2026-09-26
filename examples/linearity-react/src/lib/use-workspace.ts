import { useParams } from "@tanstack/react-router"
import { useDemo } from "./store.ts"

export function useWorkspace() {
  const { workspaceId } = useParams({ from: "/$workspaceId" })
  return useDemo().data.workspaces.find((workspace) => workspace.id === workspaceId)!
}
