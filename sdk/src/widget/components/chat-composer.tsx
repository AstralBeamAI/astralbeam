import { ArrowClockwiseIcon, ArrowUpIcon, PaperclipIcon, StopIcon } from "@phosphor-icons/react"
import { useId, useRef, useState } from "react"
import { Alert, AlertAction, AlertDescription } from "@/widget/components/ui/alert"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/widget/components/ui/input-group"
import { attachmentAcceptAttribute } from "../lib/attachments.ts"
import type { DraftAttachment, ResolvedAttachmentOptions } from "../lib/types.ts"
import { cn } from "cn"
import { describeError } from "../lib/utils.ts"
import { isAstralBeamApiError } from "../../api/api.ts"
import { ComposerAttachments } from "./composer-attachments.tsx"
import { TooltipButton } from "./tooltip-button.tsx"

interface ChatComposerProps {
  /** Widget title, used in the input's placeholder ("Message <title>…"). */
  title: string
  /** Name of the host's composer-actions slot; when set, extra host controls project into the row. */
  actionsSlot?: string | undefined
  draft: string
  onDraftChange: (draft: string) => void
  onSend: () => void
  onStop: () => void
  /** Retry unacknowledged input, or refresh saved history after an accepted response fails. */
  onRetry: (() => void) | undefined
  retryLabel: "Retry" | "Refresh"
  /** The chat is in its error state; `error` itself may still be undefined. */
  showError: boolean
  error: Error | undefined
  /** A run is submitted or streaming; swaps the send button for a stop button. */
  streamBusy: boolean
  /** `streamBusy` or host tools executing between runs; blocks sending. */
  isBusy: boolean
  threadLoading: boolean
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
  onSend,
  onStop,
  onRetry,
  retryLabel,
  showError,
  error,
  streamBusy,
  isBusy,
  threadLoading,
  authPending,
  authError,
  onAuthRetry,
  attachments,
  attachmentLimits,
  onAddFiles,
  onRemoveAttachment,
}: ChatComposerProps) {
  const shortcutId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [dropTarget, setDropTarget] = useState(false)
  const blocked = authPending || authError !== undefined || threadLoading
  // A file still being read would be left out of the message, so the send waits for it.
  const reading = attachments.some((attachment) => attachment.status === "reading")
  const sendable = attachments.some((attachment) => attachment.status === "ready")
  const attachmentsFull =
    attachments.filter((attachment) => attachment.status !== "error").length >=
    attachmentLimits.maxFiles
  const canAttach = attachmentLimits.enabled && !blocked
  const sendDisabled = isBusy || blocked || reading || (draft.trim().length === 0 && !sendable)

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
        if (!sendDisabled) onSend()
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
        <Alert
          variant="destructive"
          className="mb-1.5 flex items-center gap-2 border-destructive/30 bg-destructive/5 py-1 has-data-[slot=alert-action]:pe-2.5"
        >
          <AlertDescription className="min-w-0 flex-1 text-xs text-pretty wrap-anywhere">
            <div>{describeError(error)}</div>
            {isAstralBeamApiError(error) && error.body?.reference && (
              <div className="mt-0.5 text-muted-foreground">
                Support reference: {error.body.reference}
              </div>
            )}
          </AlertDescription>
          {onRetry && (
            <AlertAction className="static shrink-0">
              <TooltipButton
                type="button"
                variant="outline"
                size="icon-sm"
                tooltip={retryLabel}
                onClick={onRetry}
              >
                <ArrowClockwiseIcon />
              </TooltipButton>
            </AlertAction>
          )}
        </Alert>
      )}
      {authError && (
        <Alert
          variant="destructive"
          className="mb-1.5 flex items-center gap-2 border-destructive/30 bg-destructive/5 py-1 has-data-[slot=alert-action]:pe-2.5"
        >
          <AlertDescription className="min-w-0 flex-1 text-xs text-pretty wrap-anywhere">
            {isAstralBeamApiError(authError) && authError.status === 401
              ? "The assistant's connection was rejected. Contact this app's support team."
              : "The assistant could not verify your session. Retry or contact this app's support team."}
          </AlertDescription>
          {onAuthRetry && (
            <AlertAction className="static shrink-0">
              <TooltipButton
                type="button"
                variant="outline"
                size="icon-sm"
                tooltip="Retry"
                onClick={onAuthRetry}
              >
                <ArrowClockwiseIcon />
              </TooltipButton>
            </AlertAction>
          )}
        </Alert>
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
          <InputGroupAddon align="block-start" className="py-1">
            <ComposerAttachments attachments={attachments} onRemove={onRemoveAttachment} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          aria-label="Message"
          aria-describedby={shortcutId}
          className="max-h-24 min-h-8 py-1.5 any-pointer-coarse:text-base"
          placeholder={
            authPending
              ? "Verifying your session…"
              : threadLoading
                ? "Loading conversation…"
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
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              if (!sendDisabled) onSend()
            }
          }}
        />
        <InputGroupAddon align="block-end" className="pt-0 pb-1">
          {attachmentLimits.enabled && (
            <TooltipButton
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Attach files"
              tooltip={
                attachmentsFull
                  ? `Up to ${attachmentLimits.maxFiles} files per message`
                  : "Attach files"
              }
              disabled={blocked || attachmentsFull}
              onClick={() => fileInput.current?.click()}
            >
              <PaperclipIcon />
            </TooltipButton>
          )}
          {/* Host controls project here in the host page's own style; the slot lays out as
            display: contents, so each projected child is a flex item of this row. */}
          {actionsSlot && <slot name={actionsSlot} />}
          {streamBusy ? (
            <TooltipButton
              type="button"
              variant="default"
              size="icon"
              className="ml-auto"
              tooltip="Stop"
              onClick={onStop}
            >
              <StopIcon />
            </TooltipButton>
          ) : (
            <TooltipButton
              type="submit"
              variant="default"
              size="icon"
              className="ml-auto"
              tooltip="Send"
              disabled={sendDisabled}
            >
              <ArrowUpIcon />
            </TooltipButton>
          )}
        </InputGroupAddon>
      </InputGroup>
      <p className="mt-1 text-center text-xs text-muted-foreground">
        <span id={shortcutId}>Enter to send, Shift+Enter for a new line.</span> AI can make
        mistakes.
      </p>
    </form>
  )
}
