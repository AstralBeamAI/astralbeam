import { ArrowUpIcon, PaperclipIcon, StopIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"
import { Button } from "@/widget/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/widget/components/ui/input-group"
import { attachmentAcceptAttribute } from "../lib/attachments.ts"
import type { DraftAttachment, ResolvedAttachmentOptions } from "../lib/types.ts"
import { cn } from "cn"
import { describeError } from "../lib/utils.ts"
import { isAstralBeamApiError } from "../../api/api.ts"
import { ComposerAttachments } from "./composer-attachments.tsx"

interface ChatComposerProps {
  /** Widget title, used in the input's placeholder ("Message <title>…"). */
  title: string
  /** Name of the host's composer-actions slot; when set, extra host controls project into the row. */
  actionsSlot?: string | undefined
  draft: string
  onDraftChange: (draft: string) => void
  readOnly?: boolean | undefined
  onSend: () => void
  onStop: () => void
  onSteer?: (() => void) | undefined
  saveAttachments?: boolean | undefined
  sendBlocked?: boolean | undefined
  /** Retry unacknowledged input, or refresh saved history after an accepted response fails. */
  onRetry: (() => void) | undefined
  retryLabel: "Retry" | "Refresh"
  /** The chat is in its error state; `error` itself may still be undefined. */
  showError: boolean
  error: Error | undefined
  /** A run is submitted or streaming, so Stop is available alongside Queue. */
  streamBusy: boolean
  /** Processing or pending messages. New input enters the queue. */
  isBusy: boolean
  /** Authentication is not ready, so the composer cannot start a run. */
  authPending: boolean
  authError: Error | undefined
  onAuthRetry: (() => void) | undefined
  /** Files picked for the next message, rejected ones included, in pick order. */
  attachments: readonly DraftAttachment[]
  attachmentLimits: ResolvedAttachmentOptions
  onAddFiles: (files: File[]) => void
  onRemoveAttachment: (id: string) => void
}

export function ChatComposer({
  title,
  actionsSlot,
  draft,
  onDraftChange,
  readOnly = false,
  onSend,
  onStop,
  onSteer,
  saveAttachments = false,
  sendBlocked = false,
  onRetry,
  retryLabel,
  showError,
  error,
  streamBusy,
  isBusy,
  authPending,
  authError,
  onAuthRetry,
  attachments,
  attachmentLimits,
  onAddFiles,
  onRemoveAttachment,
}: ChatComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [dropTarget, setDropTarget] = useState(false)
  const blocked = authPending || authError !== undefined
  // A file still being read would be left out of the message, so the send waits for it.
  const reading = attachments.some((attachment) => attachment.status === "reading")
  const sendable = attachments.some((attachment) => attachment.status === "ready")
  const attachmentsFull =
    attachments.filter((attachment) => attachment.status !== "error").length >=
    attachmentLimits.maxFiles
  const canAttach = attachmentLimits.enabled && !blocked
  const sendDisabled = sendBlocked || blocked || reading || (draft.trim().length === 0 && !sendable)

  const addFiles = (files: FileList | null) => {
    if (!canAttach || !files || files.length === 0) return
    onAddFiles([...files])
  }
  // Only a file drag concerns the composer; dragging selected text over it must still work.
  const isFileDrag = (transfer: DataTransfer | null) =>
    canAttach && (transfer?.types.includes("Files") ?? false)

  return (
    // The CardFooter around this form owns the border, padding, and background.
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event.dataTransfer)) return
        // Without preventDefault on the dragover the drop never fires and the browser
        // navigates to the dropped file instead.
        event.preventDefault()
        setDropTarget(true)
      }}
      onDragLeave={(event) => {
        // Fires for every child boundary crossed, so only a leave of the form itself counts.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDropTarget(false)
      }}
      onDrop={(event) => {
        if (!isFileDrag(event.dataTransfer)) return
        event.preventDefault()
        setDropTarget(false)
        addFiles(event.dataTransfer.files)
      }}
    >
      {showError && (
        <div
          role="alert"
          className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/50 px-3 py-2 text-xs text-destructive"
        >
          <div className="min-w-0 flex-1">
            <div className="break-words">{describeError(error)}</div>
            {isAstralBeamApiError(error) && error.body?.reference && (
              <div className="mt-0.5 text-muted-foreground">
                Support reference: {error.body.reference}
              </div>
            )}
          </div>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          )}
        </div>
      )}
      {authError && (
        <div
          role="alert"
          className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/50 px-3 py-2 text-xs text-destructive"
        >
          <div className="min-w-0 flex-1">The assistant could not verify your session.</div>
          {onAuthRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onAuthRetry}>
              Retry
            </Button>
          )}
        </div>
      )}
      {attachmentLimits.enabled && (
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          accept={attachmentAcceptAttribute(attachmentLimits)}
          onChange={(event) => {
            addFiles(event.currentTarget.files)
            // Clearing the value lets the same file be picked again after a removal, which
            // otherwise fires no change event.
            event.currentTarget.value = ""
          }}
        />
      )}
      <InputGroup className={cn("cursor-text", dropTarget && "border-ring ring-3 ring-ring/50")}>
        {attachments.length > 0 && (
          <InputGroupAddon align="block-start">
            <ComposerAttachments attachments={attachments} onRemove={onRemoveAttachment} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          readOnly={readOnly}
          aria-label="Message"
          className="max-h-24 min-h-9"
          placeholder={
            authPending
              ? "Verifying your session…"
              : dropTarget
                ? "Drop files to attach…"
                : `Message ${title}…`
          }
          disabled={blocked}
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          onPaste={(event) => {
            // A pasted screenshot arrives as a clipboard file with no text alongside it.
            if (!canAttach || event.clipboardData.files.length === 0) return
            event.preventDefault()
            addFiles(event.clipboardData.files)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              if (sendDisabled) return
              if ((event.metaKey || event.ctrlKey) && isBusy && onSteer) onSteer()
              else onSend()
            }
          }}
        />
        <InputGroupAddon align="block-end">
          {attachmentLimits.enabled && (
            <InputGroupButton
              type="button"
              size="icon-sm"
              aria-label="Attach files"
              title={
                attachmentsFull
                  ? `Up to ${attachmentLimits.maxFiles} files per message`
                  : "Attach images, PDFs, documents, spreadsheets, data, or text files"
              }
              disabled={blocked || attachmentsFull}
              onClick={() => fileInput.current?.click()}
            >
              <PaperclipIcon />
            </InputGroupButton>
          )}
          {/* Host controls project here in the host page's own style; the slot lays out as
            display: contents, so each projected child is a flex item of this row. */}
          {actionsSlot && <slot name={actionsSlot} />}
          {streamBusy && (
            <InputGroupButton type="button" variant="default" size="icon-sm" onClick={onStop}>
              <StopIcon />
              <span className="sr-only">Stop</span>
            </InputGroupButton>
          )}
          {isBusy && onSteer && (
            <InputGroupButton
              type="button"
              size="sm"
              title="Guide the current task after its current step finishes (⌘/Ctrl+Enter)"
              disabled={sendDisabled}
              onClick={onSteer}
            >
              Steer
            </InputGroupButton>
          )}
          <InputGroupButton
            type="submit"
            variant="default"
            size={isBusy || saveAttachments ? "sm" : "icon-sm"}
            className="ml-auto"
            title={isBusy && !saveAttachments ? "Queue this message for the next task" : undefined}
            disabled={sendDisabled}
          >
            {saveAttachments ? (
              "Save attachments"
            ) : isBusy ? (
              "Queue"
            ) : (
              <>
                <ArrowUpIcon />
                <span className="sr-only">Send</span>
              </>
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
