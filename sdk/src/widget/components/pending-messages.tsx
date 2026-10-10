import { useEffect, useState } from "react"
import { PencilSimpleIcon, XIcon } from "@phosphor-icons/react"
import type { PendingChatMessage } from "../../core/pending-messages.ts"
import { pendingMessageText } from "../../core/pending-messages.ts"
import { Button } from "./ui/button.tsx"
import { InputGroupTextarea } from "./ui/input-group.tsx"

export function PendingMessages({
  messages,
  paused,
  canSteer,
  onEdit,
  onRemove,
  onSteer,
  onResume,
  onReattach,
  onHold,
}: {
  messages: readonly PendingChatMessage[]
  paused: boolean
  canSteer: boolean
  onEdit: (id: string, text: string) => boolean
  onRemove: (id: string) => void
  onSteer: (id: string) => void
  onResume: () => void
  onReattach: (id: string) => void
  onHold: () => () => void
}) {
  const [editing, setEditing] = useState<{ id: string; text: string; release: () => void }>()
  useEffect(() => editing?.release, [editing?.release])
  const queued = messages.filter((message) => message.status !== "accepted")
  if (
    editing &&
    !queued.some((message) => message.id === editing.id && message.status === "queued")
  )
    setEditing(undefined)
  const next = queued[0]
  if (!messages.length) return null
  return (
    <div
      className="mb-2 flex w-full flex-col gap-2"
      aria-label="Pending messages"
      aria-live="polite"
    >
      {paused && next && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {next.attachmentsRequired
              ? "Reattach files to resume."
              : "Queue paused. Review messages, then resume."}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={next.attachmentsRequired || Boolean(editing)}
            onClick={onResume}
          >
            Resume queue
          </Button>
        </div>
      )}
      {messages
        .filter((message) => message.status === "accepted")
        .map((message) => (
          <p
            key={message.id}
            className="truncate text-xs text-muted-foreground"
            title={pendingMessageText(message.content)}
          >
            Guidance received · {pendingMessageText(message.content)}
          </p>
        ))}
      {next && (
        <details open={paused || Boolean(editing)}>
          <summary
            className="cursor-pointer truncate rounded-md border px-3 py-2 text-xs"
            title={pendingMessageText(next.content)}
          >
            Up next
            {queued.length > 1 && ` · +${queued.length - 1} more`}
            {` · ${pendingMessageText(next.content) || "Attached files"}`}
          </summary>
          <div className="mt-2 flex max-h-48 flex-col gap-2 overflow-y-auto">
            {queued.map((message) => (
              <div key={message.id} className="rounded-md border px-3 py-2 text-xs">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-muted-foreground">
                      {message.status === "sending"
                        ? "Confirming delivery…"
                        : message.steeringFallback
                          ? "Task finished. Queued as a follow-up."
                          : "Queued"}
                    </span>
                    {editing?.id === message.id ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault()
                          if (editing.text.trim() && onEdit(message.id, editing.text)) {
                            setEditing(undefined)
                          }
                        }}
                      >
                        <InputGroupTextarea
                          aria-label="Edit queued message"
                          value={editing.text}
                          onChange={(event) =>
                            setEditing({ ...editing, text: event.currentTarget.value })
                          }
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(undefined)}
                        >
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <p className="mt-1 break-words whitespace-pre-wrap">
                        {pendingMessageText(message.content) || "Attached files"}
                      </p>
                    )}
                    {message.attachmentsRequired && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-1"
                        onClick={() => onReattach(message.id)}
                      >
                        Reattach files
                      </Button>
                    )}
                  </div>
                  {message.status === "queued" && editing?.id !== message.id && (
                    <>
                      <Button
                        type="button"
                        size="icon-sm"
                        className="min-h-11 min-w-11"
                        variant="ghost"
                        aria-label="Edit queued message"
                        title="Edit queued message"
                        onClick={() => {
                          setEditing({
                            id: message.id,
                            text: pendingMessageText(message.content),
                            release: onHold(),
                          })
                        }}
                      >
                        <PencilSimpleIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        className="min-h-11 min-w-11"
                        variant="ghost"
                        aria-label="Remove queued message"
                        title="Remove queued message"
                        onClick={() => onRemove(message.id)}
                      >
                        <XIcon />
                      </Button>
                      {canSteer && !editing && !message.attachmentsRequired && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onSteer(message.id)}
                        >
                          Steer
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
