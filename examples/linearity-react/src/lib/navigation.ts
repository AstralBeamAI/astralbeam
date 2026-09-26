import { z } from "zod"
import { priorities, statuses, type Workspace } from "./model.ts"

export const searchSchema = z.object({
  q: z.string().max(160).optional(),
  status: z.enum(statuses).optional(),
  priority: z.enum(priorities).optional(),
  scope: z.enum(["All issues", "My issues", "Active cycle"]).optional(),
  layout: z.enum(["list", "board"]).optional(),
  assigneeId: z.uuid().optional(),
  cycle: z.enum(["Cycle 24", "Cycle 25", "No cycle"]).optional(),
})
export interface AppNavigation {
  current: () => string
  go: (url: string) => Promise<void>
}
export function workspaceUrl(workspaceId: string, path: string) {
  return `/${workspaceId}/${path}`
}
export function validateAppUrl(workspace: Workspace, value: string): string {
  if (!value.startsWith("/") || value.startsWith("//"))
    throw new Error("Use a relative URL inside the current workspace")
  const url = new URL(value, "https://linearity.example")
  const prefix = `/${workspace.id}/`
  if (url.origin !== "https://linearity.example" || !url.pathname.startsWith(prefix) || url.hash)
    throw new Error("Navigation must stay inside the current workspace")
  const path = url.pathname.slice(prefix.length)
  const [kind, id, extra] = path.split("/")
  const allowed = [
    "overview",
    "issues",
    "issues/new",
    "projects",
    "cycles",
    "team",
    "activity",
  ].includes(path)
  const issue = kind === "issues" && workspace.issues.some((entry) => entry.id === id)
  const project = kind === "projects" && workspace.projects.some((entry) => entry.id === id)
  if ((!allowed && !issue && !project) || extra)
    throw new Error("Choose an existing view, issue, or project in this workspace")
  const search = searchSchema.strict().parse(Object.fromEntries(url.searchParams))
  if (search.assigneeId && !workspace.members.some((member) => member.id === search.assigneeId))
    throw new Error("Choose a member of this workspace")
  return url.pathname + url.search
}
