import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { describeError } from "../lib/utils.ts"

interface ChatComposerProps {
  draft: string
  onDraftChange: (draft: string) => void
  onSend: () => void
  onStop: () => void
  /** Undefined hides the retry button: with no transcript there is nothing to re-run. */
  onRetry: (() => void) | undefined
  /** The chat is in its error state; `error` itself may still be undefined. */
  showError: boolean
  error: Error | undefined
  /** A run is submitted or streaming; swaps the send button for a stop button. */
  streamBusy: boolean
  /** `streamBusy` or host tools executing between runs; blocks sending. */
  isBusy: boolean
}

export function ChatComposer(
  { draft, onDraftChange, onSend, onStop, onRetry, showError, error, streamBusy, isBusy }:
    ChatComposerProps,
) {
  return (
    <form
      className="border-t p-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
    >
      {showError && (
        <div
          role="alert"
          className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/50 px-3 py-2 text-xs text-destructive"
        >
          <div className="min-w-0 flex-1">
            <div>{describeError(error)}</div>
            {error?.message && (
              <div className="mt-0.5 truncate text-muted-foreground" title={error.message}>
                {error.message}
              </div>
            )}
          </div>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}
      <InputGroup>
        <InputGroupTextarea
          aria-label="Message"
          className="max-h-24 min-h-9"
          placeholder="Message AstralBeam…"
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
        />
        <InputGroupAddon align="block-end">
          {streamBusy
            ? (
              <InputGroupButton
                type="button"
                variant="default"
                size="icon-sm"
                className="ml-auto"
                onClick={onStop}
              >
                <StopIcon />
                <span className="sr-only">Stop</span>
              </InputGroupButton>
            )
            : (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                className="ml-auto"
                disabled={isBusy || draft.trim().length === 0}
              >
                <ArrowUpIcon />
                <span className="sr-only">Send</span>
              </InputGroupButton>
            )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
