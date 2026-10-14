import type { ReactNode } from "react"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/widget/components/ui/trace"

interface ToolDisclosureProps {
  icon: ReactNode
  label: ReactNode
  /** Shimmers the label and announces it politely while the call is still in flight. */
  running?: boolean
  failed?: boolean
  /** Second line under the label, for a failure reason or a one-line summary. */
  detail?: ReactNode
  children: ReactNode
}

/** Shared tool, web, and sandbox activity, following shadcn's Trace composition. */
export function ToolDisclosure({
  icon,
  label,
  running = false,
  failed = false,
  detail,
  children,
}: ToolDisclosureProps) {
  return (
    <Trace className="min-w-0">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={failed ? "error" : running ? "running" : undefined}>
            <TraceIcon>{icon}</TraceIcon>
            <TraceTitle
              className="whitespace-normal wrap-anywhere"
              aria-live={running ? "polite" : undefined}
            >
              {label}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        {detail && (
          <TraceDescription className="min-w-0 ps-7 text-xs wrap-anywhere">
            {detail}
          </TraceDescription>
        )}
        <TraceCollapsibleContent className="min-w-0">{children}</TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
