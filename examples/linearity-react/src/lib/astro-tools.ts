import { defineTool } from "@astralbeam/sdk/core"
import { z } from "zod"
import { issueFields, statuses } from "./model.ts"
import { demoStore } from "./store.ts"

export function createWorkspaceTools(workspaceId: string) {
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
          projects: current.projects,
          members: current.members,
          activity: current.activity,
          cycles: ["Cycle 24", "Cycle 25", "No cycle"],
        }
      },
    }),
    list_issues: defineTool({
      metadata: { title: "Look up issues" },
      description:
        "List current issues in the active workspace. Optional filters narrow the list. Use the returned opaque issue IDs for changes and issueCard widgets.",
      parameters: z.object({
        query: z.string().optional(),
        status: z.enum(statuses).optional(),
        projectId: z.uuid().optional(),
        assigneeId: z.uuid().optional(),
      }),
      execute: ({ query, status, projectId, assigneeId }) =>
        demoStore
          .workspace(workspaceId)
          .issues.filter(
            (issue) =>
              (!query || issue.title.toLowerCase().includes(query.toLowerCase())) &&
              (!status || issue.status === status) &&
              (!projectId || issue.projectId === projectId) &&
              (!assigneeId || issue.assigneeId === assigneeId),
          ),
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
        "Change the supplied fields of an existing issue in the active workspace. Omit fields to leave them unchanged. Use null only to unassign. Read current issues first and show changes with issueCard.",
      parameters: z.object({ id: z.uuid(), changes: issueFields.partial() }),
      execute: ({ id, changes }) => demoStore.update(workspaceId, id, changes, "Astro"),
    }),
  }
}
