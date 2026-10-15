import { useState } from "react"
import { BrainIcon } from "@phosphor-icons/react"
import { Spinner } from "./ui/spinner.tsx"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "./ui/trace.tsx"

export function ReasoningPart({ content, running }: { content: string; running: boolean }) {
  const [open, setOpen] = useState<boolean>()
  // Until reasoning has content, the transcript's own "Thinking…" marker stands in for it.
  if (!content) return null
  return (
    <Trace>
      <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : undefined}>
            <TraceIcon>{running ? <Spinner /> : <BrainIcon />}</TraceIcon>
            <TraceTitle aria-live={running ? "polite" : undefined}>
              {running ? "Thinking…" : "Thought"}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="text-xs whitespace-pre-wrap">
          {content}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
