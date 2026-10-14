import { useCallback, useRef } from "react"
import type { WebCitation } from "../../core/web.ts"
import { WIDGET_CONTAINER_CLASS } from "../../lib/constants.ts"
import { buttonVariants } from "./ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card"

export function InlineCitation({ citation, href }: { citation: WebCitation; href: string }) {
  const container = useRef<HTMLElement | null>(null)
  const setTrigger = useCallback((element: HTMLAnchorElement | null) => {
    // Keep the popup outside transcript containment and inside fullscreen chat's stacking context.
    container.current = element?.closest(`[data-slot=chat], .${WIDGET_CONTAINER_CLASS}`) ?? null
  }, [])
  return (
    <HoverCard>
      <HoverCardTrigger
        ref={setTrigger}
        href={href}
        target="_blank"
        rel="nofollow noopener noreferrer"
        referrerPolicy="no-referrer"
        aria-label={`Source ${citation.number}: ${citation.title} (opens in a new tab)`}
        className={buttonVariants({
          variant: "secondary",
          size: "xs",
          className: "mx-0.5 h-5 min-w-5 rounded-sm px-1 text-[0.65rem] align-baseline",
        })}
      >
        {citation.number}
      </HoverCardTrigger>
      <HoverCardContent
        container={container}
        align="start"
        collisionAvoidance={{ side: "flip", align: "shift" }}
        className="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1"
      >
        <p className="font-medium wrap-break-word">{citation.title}</p>
        <p className="text-xs text-muted-foreground">{new URL(href).hostname}</p>
        {citation.excerpt && (
          <p className="text-xs leading-relaxed wrap-break-word">{citation.excerpt}</p>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
