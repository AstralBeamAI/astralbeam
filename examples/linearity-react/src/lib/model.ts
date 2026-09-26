import { z } from "zod"

export const statuses = ["Backlog", "Todo", "In progress", "In review", "Done", "Canceled"] as const
export const priorities = ["Urgent", "High", "Medium", "Low", "None"] as const
export const labels = ["Feature", "Bug", "Improvement", "Infrastructure", "Security"] as const
export const issueFields = z.object({
  title: z.string().trim().min(1, "Give the issue a title").max(160),
  description: z.string().max(8000),
  status: z.enum(statuses),
  priority: z.enum(priorities),
  assigneeId: z.uuid().nullable(),
  projectId: z.uuid(),
  cycle: z.enum(["Cycle 24", "Cycle 25", "No cycle"]),
  label: z.enum(labels),
})
const issueSchema = issueFields.extend({ id: z.uuid(), number: z.number().int().positive() })
const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  target: z.string(),
  leadId: z.uuid(),
})
const memberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  initials: z.string(),
  color: z.string(),
  role: z.string(),
})
const activitySchema = z.object({
  id: z.uuid(),
  text: z.string(),
  actor: z.string(),
  at: z.string(),
})
const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  initials: z.string(),
  prefix: z.string(),
  tagline: z.string(),
  members: z.array(memberSchema).min(1),
  projects: z.array(projectSchema).min(1),
  issues: z.array(issueSchema),
  activity: z.array(activitySchema),
  nextNumber: z.number().int().positive(),
})
export const dataSchema = z
  .object({
    version: z.literal(1),
    visitorId: z.uuid(),
    activeWorkspaceId: z.uuid(),
    workspaces: z.array(workspaceSchema).length(2),
  })
  .refine((data) => data.workspaces.some((workspace) => workspace.id === data.activeWorkspaceId))
export type Issue = z.infer<typeof issueSchema>
export type IssueFields = z.infer<typeof issueFields>
export type Workspace = z.infer<typeof workspaceSchema>
export type DemoData = z.infer<typeof dataSchema>
export type Member = z.infer<typeof memberSchema>

export const demoWorkspaces = [
  {
    id: "8f25a5c7-28cc-49d4-b4c6-21c20a781d01",
    name: "Acme",
    initials: "A",
    prefix: "ACM",
    tagline: "Building the next chapter of commerce.",
  },
  {
    id: "8f25a5c7-28cc-49d4-b4c6-21c20a781d02",
    name: "Orbit",
    initials: "O",
    prefix: "ORB",
    tagline: "The infrastructure behind great teams.",
  },
] as const

export function validateReferences(workspace: Workspace, fields: IssueFields) {
  if (!workspace.projects.some((project) => project.id === fields.projectId))
    throw new Error("Choose a project in this workspace")
  if (fields.assigneeId && !workspace.members.some((member) => member.id === fields.assigneeId))
    throw new Error("Choose a member of this workspace")
}

export function addIssue(workspace: Workspace, input: unknown): Issue {
  const fields = issueFields.parse(input)
  validateReferences(workspace, fields)
  return { ...fields, id: crypto.randomUUID(), number: workspace.nextNumber }
}

export function editIssue(workspace: Workspace, id: string, input: unknown): Issue {
  const issue = workspace.issues.find((candidate) => candidate.id === id)
  if (!issue) throw new Error("This issue is not in the active workspace")
  const fields = issueFields.parse({ ...issue, ...issueFields.partial().parse(input) })
  validateReferences(workspace, fields)
  return { ...issue, ...fields }
}
