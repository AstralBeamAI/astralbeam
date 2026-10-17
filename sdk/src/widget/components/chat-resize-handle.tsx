import { Separator } from "@base-ui/react/separator"
import type { useChatWidth } from "../use-chat-width.ts"

export function ChatResizeHandle({
  sizing,
  panelId,
}: {
  sizing: ReturnType<typeof useChatWidth>
  panelId: string
}) {
  if (!sizing.enabled) return null
  return (
    <Separator
      orientation="vertical"
      tabIndex={0}
      aria-label="Resize chat"
      aria-controls={panelId}
      aria-valuemin={sizing.minimum}
      aria-valuemax={sizing.maximum}
      aria-valuenow={sizing.width}
      aria-valuetext={`${sizing.width} pixels`}
      className="absolute inset-y-0 start-0 z-20 w-2 touch-none cursor-col-resize border-s border-transparent hover:border-primary/20 focus-visible:border-primary/30 focus-visible:outline-none"
      onPointerDown={sizing.onPointerDown}
      onPointerMove={sizing.onPointerMove}
      onPointerUp={sizing.onPointerUp}
      onPointerCancel={sizing.cancelDrag}
      onLostPointerCapture={sizing.cancelDrag}
      onKeyDown={sizing.onKeyDown}
    />
  )
}
