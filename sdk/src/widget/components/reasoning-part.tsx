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
  if (!content && !running) return null
  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>{running ? <Spinner /> : <BrainIcon />}</TraceIcon>
      <TraceTitle aria-live={running ? "polite" : undefined}>
        {running ? "Thinking…" : "Thought"}
      </TraceTitle>
    </TraceLine>
  )
  return (
    <Trace>
      {content ? (
        <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="text-xs whitespace-pre-wrap">
            {content}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        line
      )}
    </Trace>
  )
}
