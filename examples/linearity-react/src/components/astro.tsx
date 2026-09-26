import { AstralBeamChat, defineWidget } from "@astralbeam/sdk/react"
import {
  ArrowUpRightIcon,
  CheckSquareIcon,
  CompassIcon,
  SparkleIcon,
  StarFourIcon,
} from "@phosphor-icons/react"
import { z } from "zod"
import { type Issue, type Workspace } from "@/lib/model.ts"
import { createWorkspaceTools } from "@/lib/astro-tools.ts"
import { StatusIcon } from "./issue-bits.tsx"

export function Astro({
  workspace,
  visitorId,
  onOpen,
}: {
  workspace: Workspace
  visitorId: string
  onOpen: (issue: Issue) => void
}) {
  const workspaceId = workspace.id

  return (
    <AstralBeamChat
      title="Astro"
      colorScheme="light"
      apiUrl={import.meta.env.VITE_ASTRALBEAM_API_URL || "https://app.astralbeam.ai/api"}
      agentId={import.meta.env.VITE_ASTRALBEAM_AGENT_ID || undefined}
      fetchAstralBeamToken={{
        url: "/api/astralbeam/token",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, visitorId }),
      }}
      tools={createWorkspaceTools(workspaceId)}
      theme={{
        light: {
          "--background": "#fcfcfd",
          "--foreground": "#30303b",
          "--primary": "#6965d8",
          "--primary-foreground": "#ffffff",
          "--muted": "#f3f3f6",
          "--muted-foreground": "#81818d",
          "--border": "#e9e9ef",
          "--ring": "#6965d8",
          "--radius": "0.75rem",
        },
      }}
      showHeader={false}
      empty={
        <div className="astro-welcome">
          <span className="astro-orbit">
            <StarFourIcon size={29} weight="fill" />
          </span>
          <span className="eyebrow">A LITTLE EXTRA MOMENTUM</span>
          <h2>
            Big plans.
            <br />
            Meet your copilot.
          </h2>
          <p>
            I’m Astro. I can find the loose ends, move work forward, and give your team a little
            breathing room.
          </p>
          <div className="prompt-examples">
            <span>Try asking me</span>
            <div>
              <CompassIcon size={18} />
              <p>What should we focus on this cycle?</p>
              <ArrowUpRightIcon size={14} />
            </div>
            <div>
              <CheckSquareIcon size={18} />
              <p>
                {workspace.prefix === "ACM"
                  ? "Assign the SSO issue to Maya and make it urgent."
                  : "Assign the failover issue to Maya and make it urgent."}
              </p>
              <ArrowUpRightIcon size={14} />
            </div>
            <div>
              <SparkleIcon size={18} />
              <p>
                {workspace.prefix === "ACM"
                  ? "Create a launch checklist for enterprise readiness."
                  : "Create a launch checklist for platform reliability."}
              </p>
              <ArrowUpRightIcon size={14} />
            </div>
          </div>
          <small>I work with the issues in your current workspace.</small>
        </div>
      }
      widgets={{
        issueCard: defineWidget({
          description:
            "Show a live issue card in chat after creating, changing, or discussing an issue. Uses the issue's opaque UUID.",
          parameters: z.object({ id: z.uuid() }),
          render: ({ id }) => {
            const issue = workspace.issues.find((entry) => entry.id === id)
            return issue ? (
              <button type="button" className="astro-issue-card" onClick={() => onOpen(issue)}>
                <span>
                  <StatusIcon status={issue.status} />
                  {workspace.prefix}-{issue.number}
                  <ArrowUpRightIcon size={14} />
                </span>
                <strong>{issue.title}</strong>
                <small>
                  {issue.status} · {issue.priority} priority
                </small>
              </button>
            ) : (
              <p>This issue was removed.</p>
            )
          },
        }),
      }}
    />
  )
}
