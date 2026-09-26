import { demoWorkspaces, type DemoData, type Issue, type Workspace } from "./model.ts"

const people = [
  ["Avery Chen", "AC", "sage", "Product lead"],
  ["Maya Patel", "MP", "purple", "Engineering"],
  ["Theo Brooks", "TB", "blue", "Engineering"],
  ["Sofia Rivera", "SR", "rose", "Design"],
  ["Leo Kim", "LK", "amber", "Engineering"],
] as const
const acmeIssues = [
  ["Add workspace-level SSO enforcement", "In progress", "High", "Security", 1, 0],
  ["Resolve duplicate webhook deliveries", "In progress", "Urgent", "Bug", 2, 1],
  ["Design the new onboarding checklist", "In progress", "Medium", "Feature", 3, 2],
  ["Support bulk member invitations", "In progress", "High", "Feature", 4, 0],
  ["Audit log export for enterprise plans", "In review", "High", "Security", 1, 0],
  ["Improve empty states across the dashboard", "In review", "Low", "Improvement", 3, 2],
  ["Add idempotency keys to the payments API", "Todo", "High", "Infrastructure", 2, 1],
  ["Show usage breakdown by workspace", "Todo", "Medium", "Feature", 0, 1],
  ["Keyboard navigation for command menu", "Todo", "Medium", "Improvement", 4, 2],
  ["Define retention policy for audit events", "Todo", "High", "Security", 1, 0],
  ["Mobile layout for billing settings", "Backlog", "Low", "Improvement", 3, 1],
  ["SCIM directory provisioning", "Backlog", "High", "Feature", 1, 0],
  ["Add a guided product tour", "Backlog", "Medium", "Feature", 0, 2],
  ["Migrate API keys to scoped permissions", "Done", "High", "Security", 2, 0],
  ["Ship the refreshed workspace switcher", "Done", "Medium", "Improvement", 3, 2],
  ["Reduce webhook retry latency", "Done", "High", "Infrastructure", 4, 1],
  ["Instrument activation funnel events", "Done", "Medium", "Infrastructure", 0, 2],
  ["Standardize API error responses", "Done", "Medium", "Improvement", 2, 1],
] as const
const orbitTitles = [
  "Ship regional failover controls",
  "Fix stalled deployment health checks",
  "Design service dependency maps",
  "Add environment access policies",
  "Review disaster recovery runbook",
  "Polish deployment timeline",
  "Implement canary release gates",
  "Track compute costs per service",
  "Add keyboard shortcuts to logs",
  "Document incident escalation paths",
  "Improve mobile incident view",
  "Build private networking support",
  "Create a first-deployment guide",
  "Rotate service credentials automatically",
  "Ship environment switcher",
  "Reduce cold-start latency",
  "Instrument deployment success metrics",
  "Normalize service error codes",
]
function seedWorkspace(index: 0 | 1): Workspace {
  const base = demoWorkspaces[index]
  const uuid = (n: number) => `74dcb815-bc71-4f65-a10${index}-${String(n).padStart(12, "0")}`
  const members = people.map(([name, initials, color, role], i) => ({
    id: uuid(i + 1),
    name,
    initials,
    color,
    role,
  }))
  const projects = [
    {
      id: uuid(20),
      name: index === 0 ? "Enterprise readiness" : "Platform reliability",
      description:
        index === 0
          ? "The controls and confidence larger teams need."
          : "Reliable infrastructure in every region.",
      color: "purple",
      target: "Oct 16",
      leadId: uuid(2),
    },
    {
      id: uuid(21),
      name: index === 0 ? "Billing & payments" : "Developer platform",
      description:
        index === 0
          ? "Make every transaction feel effortless."
          : "From first deploy to production, without friction.",
      color: "amber",
      target: "Oct 23",
      leadId: uuid(3),
    },
    {
      id: uuid(22),
      name: index === 0 ? "Product experience" : "Observability",
      description:
        index === 0
          ? "A thoughtful first impression, every day."
          : "Understand every service at a glance.",
      color: "sage",
      target: "Oct 30",
      leadId: uuid(4),
    },
  ]
  const issues: Issue[] = acmeIssues.map(
    ([title, status, priority, label, member, project], i) => ({
      id: uuid(100 + i),
      number: 128 + i,
      title: index === 0 ? title : orbitTitles[i]!,
      status: index === 0 && i === 0 ? "Todo" : status,
      priority,
      label,
      assigneeId: index === 0 && i === 0 ? null : members[member]!.id,
      projectId: projects[project]!.id,
      description:
        index === 0 && i === 0
          ? "Atlas starts its enterprise pilot on Monday. Their security team requires SSO enforcement before they can invite employees. This is the remaining launch blocker.\n\nAcceptance criteria\n• Require SAML sign-in for all workspace members.\n• Keep a recovery path for workspace administrators.\n• Verify existing sessions expire when enforcement is enabled.\n\nCoordinate the rollout with Maya and get security sign-off before the pilot opens."
          : `${index === 0 ? title : orbitTitles[i]}.\n\nScope\nMake this work consistently across all workspaces, including empty and error states.\n\nAcceptance criteria\n• The main flow is accessible with a keyboard.\n• Loading and failure states have clear next steps.\n• Document the behavior for the team before shipping.`,
      cycle: i < 10 || status === "Done" ? "Cycle 24" : "Cycle 25",
    }),
  )
  return {
    ...base,
    members,
    projects,
    issues,
    nextNumber: 146,
    activity: [
      {
        id: uuid(201),
        text: `${base.prefix}-141 moved to Done`,
        actor: "Theo Brooks",
        at: "2026-09-26T08:42:00.000Z",
      },
      {
        id: uuid(202),
        text: `Created ${projects[0]!.name}`,
        actor: "Avery Chen",
        at: "2026-09-25T10:15:00.000Z",
      },
    ],
  }
}
export function initialData(visitorId: string): DemoData {
  return {
    version: 1,
    visitorId,
    activeWorkspaceId: demoWorkspaces[0].id,
    workspaces: [seedWorkspace(0), seedWorkspace(1)],
  }
}
