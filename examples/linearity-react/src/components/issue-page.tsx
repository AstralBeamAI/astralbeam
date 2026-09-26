import { useState } from "react"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { ArrowLeftIcon, CheckIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react"
import { Button } from "./ui/button.tsx"
import { Input } from "./ui/input.tsx"
import { Textarea } from "./ui/textarea.tsx"
import { Avatar } from "./issue-bits.tsx"
import {
  issueFields,
  labels,
  priorities,
  statuses,
  type Issue,
  type IssueFields,
  type Workspace,
} from "@/lib/model.ts"
import { demoStore, useDemo } from "@/lib/store.ts"
import { useWorkspace } from "@/lib/use-workspace.ts"
import { workspaceUrl } from "@/lib/navigation.ts"

export function IssuePage() {
  const { issueId } = useParams({ strict: false })
  return <IssueDetails key={issueId ?? "new"} issueId={issueId} />
}
function IssueDetails({ issueId }: { issueId: string | undefined }) {
  const workspace = useWorkspace()
  const { notice } = useDemo()
  const issue = workspace.issues.find((entry) => entry.id === issueId)
  const route = useNavigate()
  const search = useSearch({ from: "/$workspaceId" })
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState("")
  const back = () => void route({ href: workspaceUrl(workspace.id, "issues") })
  const project = workspace.projects.find((entry) => entry.id === issue?.projectId)
  const code = issue ? `${workspace.prefix}-${issue.number}` : "New issue"
  return (
    <article className="issue-page">
      <div className="issue-page-toolbar">
        <button type="button" className="back-link" onClick={back}>
          <ArrowLeftIcon size={15} /> All issues
        </button>
        <span className="spacer" />
        {issue && (
          <span className="issue-save-note">
            <CheckIcon size={14} /> {notice ? "Saved for this session" : "Saved on this browser"}
          </span>
        )}
      </div>
      {issueId && !issue ? (
        <div className="empty-state">
          <h1>Issue not found</h1>
          <p>This issue was removed or belongs to another workspace.</p>
          <Button onClick={back}>Back to issues</Button>
        </div>
      ) : (
        <>
          <div className="issue-page-heading">
            <div className="issue-page-location">
              <span>{code}</span>
              {project && (
                <>
                  <span>/</span>
                  <button
                    type="button"
                    onClick={() =>
                      void route({ href: workspaceUrl(workspace.id, `projects/${project.id}`) })
                    }
                  >
                    {project.name}
                  </button>
                </>
              )}
            </div>
            <h1>{issue?.title ?? "Create an issue"}</h1>
          </div>
          {!issue || editing ? (
            <IssueEditor
              key={issue?.id ?? "new"}
              workspace={workspace}
              issue={issue}
              initialStatus={search.status ?? "Todo"}
              onCancel={() => {
                if (issue) setEditing(false)
                else back()
              }}
              onSave={(saved) => {
                setEditing(false)
                void route({ href: workspaceUrl(workspace.id, `issues/${saved.id}`) })
              }}
            />
          ) : (
            <div className="issue-page-grid">
              <div className="issue-body">
                <div className="issue-section-title">
                  <h2>Description</h2>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    <PencilSimpleIcon /> Edit details
                  </Button>
                </div>
                <div className="issue-description">
                  {issue.description ? (
                    issue.description
                      .split("\n\n")
                      .map((paragraph) => <p key={paragraph}>{paragraph}</p>)
                  ) : (
                    <p className="subtle">Add context so the team knows what success looks like.</p>
                  )}
                </div>
                <section className="issue-activity" aria-label="Issue activity">
                  <h2>Activity</h2>
                  {workspace.activity
                    .filter((entry) => entry.text.includes(code))
                    .slice(0, 3)
                    .map((entry) => (
                      <div key={entry.id}>
                        <Avatar
                          member={workspace.members.find((member) => member.name === entry.actor)}
                          small
                        />
                        <div>
                          <strong>{entry.actor}</strong>
                          <p>{entry.text}</p>
                        </div>
                      </div>
                    ))}
                  {!workspace.activity.some((entry) => entry.text.includes(code)) && (
                    <p className="subtle">Updates from your team and Astro will appear here.</p>
                  )}
                </section>
              </div>
              <aside className="issue-properties" aria-label="Issue properties">
                <h2>Properties</h2>
                <IssueProperties
                  workspace={workspace}
                  value={issue}
                  onChange={(changes) => {
                    try {
                      demoStore.update(workspace.id, issue.id, changes)
                      setError("")
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Could not save the issue")
                    }
                  }}
                />
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="delete-issue"
                  onClick={() => {
                    if (confirmDelete) {
                      demoStore.remove(workspace.id, issue.id)
                      back()
                    } else setConfirmDelete(true)
                  }}
                >
                  <TrashIcon />
                  {confirmDelete ? "Confirm delete" : "Delete issue"}
                </Button>
              </aside>
            </div>
          )}
        </>
      )}
    </article>
  )
}

function IssueEditor({
  workspace,
  issue,
  initialStatus,
  onCancel,
  onSave,
}: {
  workspace: Workspace
  issue: Issue | undefined
  initialStatus: Issue["status"]
  onCancel: () => void
  onSave: (issue: Issue) => void
}) {
  const [draft, setDraft] = useState<IssueFields>(
    issue ?? {
      title: "",
      description: "",
      status: initialStatus,
      priority: "Medium",
      assigneeId: null,
      projectId: workspace.projects[0]!.id,
      cycle: "Cycle 24",
      label: "Feature",
    },
  )
  const [error, setError] = useState("")
  return (
    <form
      className="issue-page-grid issue-editor"
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = issueFields.safeParse(draft)
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check the issue details")
          return
        }
        try {
          onSave(
            issue
              ? demoStore.update(workspace.id, issue.id, parsed.data)
              : demoStore.create(workspace.id, parsed.data),
          )
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The issue could not be saved")
        }
      }}
    >
      <div className="issue-body">
        <label className="field-label" htmlFor="issue-title">
          Title
        </label>
        <Input
          id="issue-title"
          className="issue-title-input"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="What needs to happen?"
          required
          maxLength={160}
        />
        <label className="field-label" htmlFor="issue-description">
          Description
        </label>
        <Textarea
          id="issue-description"
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          placeholder="Add context, a plan, or acceptance criteria…"
          rows={10}
          maxLength={8000}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="submit">{issue ? "Save changes" : "Create issue"}</Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
      <aside className="issue-properties" aria-label="Issue properties">
        <h2>Properties</h2>
        <IssueProperties
          workspace={workspace}
          value={draft}
          onChange={(changes) => setDraft({ ...draft, ...changes })}
        />
      </aside>
    </form>
  )
}
function IssueProperties({
  workspace,
  value,
  onChange,
}: {
  workspace: Workspace
  value: IssueFields
  onChange: (changes: Partial<IssueFields>) => void
}) {
  return (
    <div className="property-fields">
      <label>
        Status
        <select
          value={value.status}
          onChange={(event) => onChange({ status: event.target.value as Issue["status"] })}
        >
          {statuses.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select
          value={value.priority}
          onChange={(event) => onChange({ priority: event.target.value as Issue["priority"] })}
        >
          {priorities.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
      </label>
      <label>
        Assignee
        <select
          value={value.assigneeId ?? ""}
          onChange={(event) => onChange({ assigneeId: event.target.value || null })}
        >
          <option value="">Unassigned</option>
          {workspace.members.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project
        <select
          value={value.projectId}
          onChange={(event) => onChange({ projectId: event.target.value })}
        >
          {workspace.projects.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Cycle
        <select
          value={value.cycle}
          onChange={(event) => onChange({ cycle: event.target.value as Issue["cycle"] })}
        >
          {["Cycle 24", "Cycle 25", "No cycle"].map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
      </label>
      <label>
        Label
        <select
          value={value.label}
          onChange={(event) => onChange({ label: event.target.value as Issue["label"] })}
        >
          {labels.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
