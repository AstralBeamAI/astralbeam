import { AstralBeamChat, type AstralBeamChatCore, defineWidget } from "@astralbeam/sdk/react"
import {
  ArrowUpRightIcon,
  CheckIcon,
  CheckSquareIcon,
  CompassIcon,
  StarFourIcon,
} from "@phosphor-icons/react"
import { z } from "zod"
import { type Issue, type Workspace } from "@/lib/model.ts"
import { demoStore } from "@/lib/store.ts"
import { Avatar, PriorityIcon, StatusIcon } from "./issue-bits.tsx"

export function Astro({
  chat,
  workspace,
  resizeContainer,
  onOpen,
  onClose,
}: {
  chat: AstralBeamChatCore
  workspace: Workspace
  resizeContainer?: (() => HTMLElement | null) | undefined
  onOpen: (issue: Issue) => void
  onClose: () => void
}) {
  return (
    <AstralBeamChat
      chat={chat}
      resizeContainer={resizeContainer}
      title="Astro"
      onClose={onClose}
      showConversationTitle
      header={
        <div className="astro-header">
          <span className="astro-avatar">
            <StarFourIcon size={19} weight="fill" />
          </span>
          <div>
            <strong>Astro</strong>
            <span>
              {workspace.name} · {workspace.issues.length} issues
            </span>
          </div>
        </div>
      }
      colorScheme="light"
      theme={{
        light: {
          "--background": "#fcfcfd",
          "--foreground": "#242432",
          "--primary": "#5b50c8",
          "--primary-foreground": "#ffffff",
          "--muted": "#f3f3f6",
          "--muted-foreground": "#606070",
          "--border": "#d9d9e3",
          "--ring": "#6965d8",
          "--radius": "0.75rem",
        },
      }}
      empty={
        <div className="astro-welcome">
          <div className="prompt-examples">
            <span>Try asking me</span>
            <div>
              <CompassIcon size={18} />
              <p>
                {workspace.prefix === "ACM"
                  ? "Open the SSO launch blocker."
                  : "Open the regional failover issue."}
              </p>
            </div>
            <div>
              <CheckSquareIcon size={18} />
              <p>
                {workspace.prefix === "ACM"
                  ? "Assign the SSO issue to Maya and make it urgent."
                  : "Assign the failover issue to Maya and make it urgent."}
              </p>
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
                <div className="astro-card-details">
                  <span>
                    <StatusIcon status={issue.status} />
                    {issue.status}
                  </span>
                  <span>
                    <PriorityIcon priority={issue.priority} />
                    {issue.priority}
                  </span>
                </div>
                <div className="astro-card-owner">
                  <Avatar
                    member={workspace.members.find((member) => member.id === issue.assigneeId)}
                    small
                  />
                  <span>
                    {workspace.members.find((member) => member.id === issue.assigneeId)?.name ??
                      "Unassigned"}
                  </span>
                  <span className="spacer" />
                  <small>Open issue</small>
                </div>
              </button>
            ) : (
              <p>This issue was removed.</p>
            )
          },
        }),
        assigneePicker: defineWidget({
          description:
            "Show an interactive owner picker for an issue. Use when the user wants to choose an assignee in chat. The buttons immediately assign the selected workspace member and update the issue page. Pass the issue's opaque UUID.",
          parameters: z.object({ id: z.uuid() }),
          render: ({ id }) => {
            const issue = workspace.issues.find((entry) => entry.id === id)
            if (!issue) return <p>This issue was removed.</p>
            const owner = workspace.members.find((member) => member.id === issue.assigneeId)
            return (
              <section className="astro-assignee-picker" aria-label="Choose an issue owner">
                <span className="eyebrow">
                  {workspace.prefix}-{issue.number} / OWNER
                </span>
                <h3>Who should take this?</h3>
                <div className="assignee-options">
                  {workspace.members.map((member) => (
                    <button
                      type="button"
                      key={member.id}
                      aria-label={`Assign to ${member.name}`}
                      aria-pressed={issue.assigneeId === member.id}
                      onClick={() =>
                        demoStore.update(workspace.id, issue.id, { assigneeId: member.id })
                      }
                    >
                      <Avatar member={member} small />
                      <span>{member.name}</span>
                      {issue.assigneeId === member.id && <CheckIcon size={14} />}
                    </button>
                  ))}
                </div>
                <p>
                  {owner ? (
                    <>
                      <CheckIcon size={14} /> Assigned to {owner.name}
                    </>
                  ) : (
                    "Choose a teammate to assign this issue."
                  )}
                </p>
              </section>
            )
          },
        }),
      }}
    />
  )
}
