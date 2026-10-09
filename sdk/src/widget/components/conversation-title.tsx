import { CopyIcon, DotsThreeIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
import type { ChatThread } from "../../core/threads.ts"
import { transcriptMarkdown } from "../lib/utils.ts"
import { Button } from "./ui/button.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx"
import { Input } from "./ui/input.tsx"

/** The open conversation's title, shown once it has one, with its rename, copy, and delete menu. */
export function ConversationTitle({
  chat,
  state,
  thread,
  onDelete,
  beforeDelete,
}: {
  chat: AstralBeamChatCore
  state: AstralBeamChatState
  thread: ChatThread
  onDelete: (threadId: string) => void
  beforeDelete: (threadId: string) => Promise<void>
}) {
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
      {renaming ? (
        <form
          className="flex min-w-0 flex-1 gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (!title.trim()) return
            setSaving(true)
            void chat.renameThread(title.trim()).then((saved) => {
              setSaving(false)
              if (saved) setRenaming(false)
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
              if (event.key === "Escape") setRenaming(false)
            }}
          />
          <Button type="submit" size="sm" disabled={!title.trim() || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
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
              aria-label="Conversation actions"
              title="Conversation actions"
              render={<Button variant="ghost" size="icon-sm" />}
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
                onClick={() => {
                  void chat
                    .deleteThread(thread, () => beforeDelete(thread.id))
                    .then((deleted) => {
                      if (deleted) onDelete(thread.id)
                    })
                }}
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
