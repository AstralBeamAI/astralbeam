import { PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { useState } from "react"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
import { Button } from "./ui/button.tsx"
import { Input } from "./ui/input.tsx"
import { SearchDropdown } from "./search-dropdown.tsx"

export function ThreadHistory({
  chat,
  state,
  onSelect,
  onDelete,
}: {
  chat: AstralBeamChatCore
  state: AstralBeamChatState
  onSelect: () => void
  onDelete: (threadId: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState("")
  const [saving, setSaving] = useState(false)
  const selected = state.thread
  const writing = state.status === "submitted" || state.status === "streaming"
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-2" data-slot="thread-history">
      <div className="flex flex-wrap items-center gap-2">
        <SearchDropdown
          popup
          label="Conversations"
          placeholder="Search conversations…"
          value={selected?.hasMessages ? selected : null}
          loadPage={chat.searchThreads}
          itemLabel={(thread) => thread.title || "Conversation"}
          disabled={state.threadLoading}
          onValueChange={(thread) => {
            if (!thread) return
            setRenaming(false)
            void chat.openThread(thread.id).then(onSelect)
          }}
        />
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="New conversation"
          title="New conversation"
          onClick={() => {
            setRenaming(false)
            chat.reset()
            onSelect()
          }}
        >
          <PlusIcon />
        </Button>
        {selected?.role === "manager" && (
          <>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Rename conversation"
              title="Rename conversation"
              disabled={state.threadLoading || writing}
              onClick={() => {
                setTitle(selected.title ?? "")
                setRenaming(!renaming)
              }}
            >
              <PencilSimpleIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Delete conversation"
              title="Delete conversation"
              disabled={state.threadLoading || writing}
              onClick={() => {
                void chat.deleteThread().then(() => {
                  if (!chat.getState().thread) {
                    onDelete(selected.id)
                    onSelect()
                  }
                })
              }}
            >
              <TrashIcon />
            </Button>
          </>
        )}
      </div>
      {renaming && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (title.trim()) {
              setSaving(true)
              void chat.renameThread(title.trim()).then((saved) => {
                setSaving(false)
                if (saved) setRenaming(false)
              })
            }
          }}
        >
          <Input
            aria-label="Conversation title"
            value={title}
            maxLength={200}
            disabled={saving}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <Button type="submit" size="sm" disabled={!title.trim() || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
      {selected?.writerActive && !writing && (
        <p className="text-xs text-muted-foreground" role="status">
          A turn is unfinished. Reopen the conversation to see updates.
        </p>
      )}
      {state.threadLoading ? (
        <span role="status" className="text-xs text-muted-foreground">
          Loading conversation…
        </span>
      ) : selected?.role === "viewer" ? (
        <span className="text-xs text-muted-foreground">You can read this conversation.</span>
      ) : null}
    </div>
  )
}
