import { CaretRightIcon } from "@phosphor-icons/react"
import type { ReactNode } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/widget/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/widget/components/ui/marker"

interface ToolDisclosureProps {
  icon: ReactNode
  label: ReactNode
  /** Shimmers the label and announces it politely while the call is still in flight. */
  running?: boolean
  /** Second line under the label, for a failure reason or a one-line summary. */
  detail?: ReactNode
  children: ReactNode
}

/**
 * The transcript row a tool call collapses to. The marker itself is the trigger, so a call reads
 * as one line until the user opens it, and the panel is the only place its detail is visible.
 * Shared by the generic JSON disclosure and the sandbox rows so the two never drift apart.
 */
export function ToolDisclosure(
  { icon, label, running = false, detail, children }: ToolDisclosureProps,
) {
  return (
    <Collapsible>
      <Marker
        render={<CollapsibleTrigger />}
        className="cursor-pointer items-start hover:text-foreground"
      >
        <MarkerIcon className="mt-0.5">{icon}</MarkerIcon>
        {
          /* The trigger is a button, so progress is announced from the label rather than with
            role="status" on the row itself. */
        }
        <MarkerContent
          aria-live={running ? "polite" : undefined}
          className={running ? "shimmer" : undefined}
        >
          {label}
          {/* Inline, so the affordance sits with the label instead of drifting to the row's edge. */}
          <CaretRightIcon className="ms-1 inline shrink-0 align-middle transition-transform group-data-[panel-open]/marker:rotate-90" />
          {detail}
        </MarkerContent>
      </Marker>
      <CollapsibleContent className="ps-6">{children}</CollapsibleContent>
    </Collapsible>
  )
}
