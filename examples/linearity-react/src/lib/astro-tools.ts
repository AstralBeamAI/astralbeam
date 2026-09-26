import { defineTool } from "@astralbeam/sdk/core"
import { z } from "zod"
import { issueFields, statuses } from "./model.ts"
import { validateAppUrl, workspaceUrl, type AppNavigation } from "./navigation.ts"
import { demoStore } from "./store.ts"

export function createWorkspaceTools(workspaceId: string, navigation: AppNavigation) {
  return {
    inspect_workspace: defineTool({
      metadata: { title: "Read workspace context" },
      description:
        "Read the current Linearity workspace, projects, members, cycles, and recent activity. Call this first for IDs and context. Only the active workspace is accessible. You are Astro, the workspace assistant. All host changes are real changes to this visitor's local demo. Never claim a change before its tool succeeds.",
      parameters: z.object({}),
      execute: () => {
        const current = demoStore.workspace(workspaceId)
        return {
          id: current.id,
          name: current.name,
          currentUrl: navigation.current(),
          views: Object.fromEntries(
            ["overview", "issues", "projects", "cycles", "team", "activity"].map((view) => [
              view,
              workspaceUrl(workspaceId, view),
            ]),
          ),
          projects: current.projects.map((project) => ({
            ...project,
            url: workspaceUrl(workspaceId, `projects/${project.id}`),
          })),
          members: current.members,
          activity: current.activity,
          cycles: ["Cycle 24", "Cycle 25", "No cycle"],
        }
      },
    }),
    list_issues: defineTool({
      metadata: { title: "Look up issues" },
      description:
        "List current issues in the active workspace. Query words match the issue title, description, or identifier. Omit query to see all issues. Use the returned opaque issue IDs for changes and issueCard widgets.",
      parameters: z.object({
        query: z.string().optional(),
        status: z.enum(statuses).optional(),
        projectId: z.uuid().optional(),
        assigneeId: z.uuid().optional(),
      }),
      execute: ({ query, status, projectId, assigneeId }) => {
        const current = demoStore.workspace(workspaceId)
        const terms = query?.trim().toLowerCase().split(/\s+/) ?? []
        return current.issues
          .filter(
            (issue) =>
              terms.every((term) =>
                `${current.prefix}-${issue.number} ${issue.title} ${issue.description}`
                  .toLowerCase()
                  .includes(term),
              ) &&
              (!status || issue.status === status) &&
              (!projectId || issue.projectId === projectId) &&
              (!assigneeId || issue.assigneeId === assigneeId),
          )
          .map((issue) => ({ ...issue, url: workspaceUrl(workspaceId, `issues/${issue.id}`) }))
      },
    }),
    navigate_app: defineTool({
      metadata: { title: "Open in Linearity" },
      description:
        "Navigate the app to a view, project, or issue in the active workspace. Use URLs from inspect_workspace or list_issues. This changes the browser URL and preserves this conversation. Call when the user asks to open, show, or go to something. Issue filters use ?q=, ?status=, ?priority=, ?assigneeId=, ?layout=board, and ?cycle=. Never navigate outside this workspace.",
      parameters: z.object({ url: z.string() }),
      execute: async ({ url }) => {
        const destination = validateAppUrl(demoStore.workspace(workspaceId), url)
        await navigation.go(destination)
        return { url: navigation.current(), opened: true }
      },
    }),
    create_issue: defineTool({
      metadata: { title: "Create an issue" },
      description:
        "Create an issue in the current workspace and save it to this browser. Use inspect_workspace for project and assignee UUIDs. Use null for unassigned. Show the result with issueCard.",
      parameters: issueFields,
      execute: (input) => demoStore.create(workspaceId, input, "Astro"),
    }),
    update_issue: defineTool({
      metadata: { title: "Update an issue" },
      description:
        "Change the supplied fields of an existing issue in the active workspace. Omit fields to leave them unchanged. Use null only to unassign. Read current issues first. Show issueCard when the user asks for a card. Otherwise, if the issue page is already open, confirm briefly because its fields update live.",
      parameters: z.object({ id: z.uuid(), changes: issueFields.partial() }),
      execute: ({ id, changes }) => demoStore.update(workspaceId, id, changes, "Astro"),
    }),
  }
}
