import { useState } from "react"
import { TrashIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx"
import { Input } from "@/components/ui/input.tsx"
import { Textarea } from "@/components/ui/textarea.tsx"
import {
  issueFields,
  labels,
  priorities,
  statuses,
  type Issue,
  type IssueFields,
  type Workspace,
} from "@/lib/model.ts"
import { demoStore } from "@/lib/store.ts"

export function IssueDialog({
  workspace,
  issue,
  projectId,
  initialStatus,
  onClose,
}: {
  workspace: Workspace
  issue: Issue | undefined
  projectId: string
  initialStatus: Issue["status"]
  onClose: () => void
}) {
  const [draft, setDraft] = useState<IssueFields>(
    issue ?? {
      title: "",
      description: "",
      status: initialStatus,
      priority: "Medium",
      assigneeId: null,
      projectId: projectId || workspace.projects[0]!.id,
      cycle: "Cycle 24",
      label: "Feature",
    },
  )
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const field = <K extends keyof IssueFields>(key: K, value: IssueFields[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const save = () => {
    const parsed = issueFields.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the issue details")
      return
    }
    try {
      if (issue) demoStore.update(workspace.id, issue.id, parsed.data)
      else demoStore.create(workspace.id, parsed.data)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The issue could not be saved")
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="issue-dialog">
        <DialogHeader>
          <span className="eyebrow">
            {workspace.name} / {issue ? `${workspace.prefix}-${issue.number}` : "New issue"}
          </span>
          <DialogTitle>{issue ? "Issue details" : "Make the next move"}</DialogTitle>
          <DialogDescription>
            {issue ? "Changes are saved to your browser." : "Give your team a clear next step."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <label className="field-label" htmlFor="issue-title">
            Title
          </label>
          <Input
            id="issue-title"
            className="issue-title-input"
            value={draft.title}
            onChange={(event) => field("title", event.target.value)}
            placeholder="What needs to happen?"
            required
            maxLength={160}
            aria-describedby={error ? "issue-error" : undefined}
          />
          <label className="field-label" htmlFor="issue-description">
            Description
          </label>
          <Textarea
            id="issue-description"
            value={draft.description}
            onChange={(event) => field("description", event.target.value)}
            placeholder="Add context, a plan, or acceptance criteria…"
            rows={6}
            maxLength={8000}
          />
          <div className="form-grid">
            <label>
              Status
              <select
                value={draft.status}
                onChange={(event) => field("status", event.target.value as Issue["status"])}
              >
                {statuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={draft.priority}
                onChange={(event) => field("priority", event.target.value as Issue["priority"])}
              >
                {priorities.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </label>
            <label>
              Assignee
              <select
                value={draft.assigneeId ?? ""}
                onChange={(event) => field("assigneeId", event.target.value || null)}
              >
                <option value="">Unassigned</option>
                {workspace.members.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                value={draft.projectId}
                onChange={(event) => field("projectId", event.target.value)}
              >
                {workspace.projects.map((project) => (
                  <option value={project.id} key={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cycle
              <select
                value={draft.cycle}
                onChange={(event) => field("cycle", event.target.value as Issue["cycle"])}
              >
                {["Cycle 24", "Cycle 25", "No cycle"].map((cycle) => (
                  <option key={cycle}>{cycle}</option>
                ))}
              </select>
            </label>
            <label>
              Label
              <select
                value={draft.label}
                onChange={(event) => field("label", event.target.value as Issue["label"])}
              >
                {labels.map((label) => (
                  <option key={label}>{label}</option>
                ))}
              </select>
            </label>
          </div>
          {error && (
            <p id="issue-error" className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {issue && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (confirmDelete) {
                    demoStore.remove(workspace.id, issue.id)
                    onClose()
                  } else setConfirmDelete(true)
                }}
              >
                <TrashIcon />
                {confirmDelete ? "Confirm delete" : "Delete issue"}
              </Button>
            )}
            <span className="spacer" />
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{issue ? "Save changes" : "Create issue"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
