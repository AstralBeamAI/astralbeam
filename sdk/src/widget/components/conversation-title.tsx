import {
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
import type { ChatThread } from "../../core/threads.ts"
import { transcriptMarkdown } from "../lib/utils.ts"
import { DeleteConversationDialog } from "./delete-conversation-dialog.tsx"
import { TooltipButton } from "./tooltip-button.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx"
import { Input } from "./ui/input.tsx"
import { Spinner } from "./ui/spinner.tsx"

/** The open conversation's title, shown once it has one, with its rename, copy, and delete menu. */
export function ConversationTitle({
  chat,
  state,
  thread,
  onDelete,
}: {
  chat: AstralBeamChatCore
  state: AstralBeamChatState
  thread: ChatThread
  onDelete: (threadId: string) => void
}) {
  const actions = useRef<HTMLButtonElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState("")
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const label = thread.title ?? ""
  const editable =
    thread.role === "manager" && state.status !== "submitted" && state.status !== "streaming"
  // The menu restores focus to its trigger as it closes, so the editor takes it a frame later.
  useEffect(() => {
    if (renaming) requestAnimationFrame(() => input.current?.select())
  }, [renaming])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <div
      ref={container}
      data-slot="conversation-title"
      className="flex h-10 shrink-0 items-center gap-1 border-b px-4"
    >
      {confirmDelete && (
        <DeleteConversationDialog
          title={label || "Untitled"}
          container={container}
          finalFocus={actions}
          onClose={() => setConfirmDelete(false)}
          onDelete={async () => {
            const deleted = await chat.deleteThread()
            if (deleted) onDelete(thread.id)
            return deleted
          }}
        />
      )}
      {renaming ? (
        <form
          className="flex min-w-0 flex-1 gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (!title.trim()) return
            setSaving(true)
            void chat.renameThread(title.trim()).then((saved) => {
              setSaving(false)
              if (saved) {
                setRenaming(false)
                requestAnimationFrame(() => actions.current?.focus())
              }
            })
          }}
        >
          <Input
            ref={input}
            aria-label="Conversation title"
            className="h-7"
            value={title}
            maxLength={200}
            disabled={saving}
            onChange={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setRenaming(false)
                requestAnimationFrame(() => actions.current?.focus())
              }
            }}
          />
          <TooltipButton
            type="button"
            size="icon-sm"
            variant="ghost"
            tooltip="Cancel"
            disabled={saving}
            onClick={() => {
              setRenaming(false)
              requestAnimationFrame(() => actions.current?.focus())
            }}
          >
            <XIcon />
          </TooltipButton>
          <TooltipButton
            type="submit"
            size="icon-sm"
            tooltip={saving ? "Saving…" : "Save"}
            disabled={!title.trim() || saving}
          >
            {saving ? <Spinner /> : <CheckIcon />}
          </TooltipButton>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={label}>
            {label}
          </span>
          {copied && (
            <span role="status" className="text-xs text-muted-foreground">
              Copied
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={actions}
              render={
                <TooltipButton tooltip="Conversation actions" variant="ghost" size="icon-sm" />
              }
            >
              <DotsThreeIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent container={container} align="end" className="w-40">
              <DropdownMenuItem
                disabled={!editable}
                onClick={() => {
                  setTitle(thread.title ?? "")
                  setRenaming(true)
                }}
              >
                <PencilSimpleIcon />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={state.messages.length === 0}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(transcriptMarkdown(label, state.messages))
                    .then(() => setCopied(true))
                }}
              >
                <CopyIcon />
                Copy Markdown
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={!editable}
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  )
}
