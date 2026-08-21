import { CheckIcon, WarningCircleIcon, WrenchIcon } from "@phosphor-icons/react"
import type { MessagePart } from "@tanstack/ai-client"
import type { ReactNode } from "react"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Spinner } from "@/components/ui/spinner"
import type { WidgetDefinition } from "../client.ts"
import { ASK_QUESTIONNAIRE_TOOL, RENDER_WIDGET_TOOL } from "../lib/constants.ts"
import type { QuestionnaireAnswer, RenderWidgetInput } from "../lib/types.ts"
import {
  getWidget,
  isSettledToolCall,
  sanitizeQuestionnaireItems,
  slotNameForToolCall,
} from "../lib/utils.ts"
import { InlineQuestionnaire } from "./inline-questionnaire.tsx"

type ToolCallPart = Extract<MessagePart, { type: "tool-call" }>

interface AssistantPartProps {
  part: MessagePart
  widgets: Record<string, WidgetDefinition>
  activeSlots: ReadonlySet<string>
  onQuestionnaireAnswers: (toolCallId: string, answers: QuestionnaireAnswer[]) => void
}

function FailureMarker({ children }: { children: ReactNode }) {
  return (
    <Marker>
      <MarkerIcon>
        <WarningCircleIcon />
      </MarkerIcon>
      <MarkerContent>{children}</MarkerContent>
    </Marker>
  )
}

function ToolCallMarker({ running, children }: { running: boolean; children: ReactNode }) {
  return (
    <Marker role={running ? "status" : undefined}>
      <MarkerIcon>{running ? <Spinner /> : <WrenchIcon />}</MarkerIcon>
      <MarkerContent className={running ? "shimmer" : ""}>{children}</MarkerContent>
    </Marker>
  )
}

function WidgetCallPart(
  { part, widgets, activeSlots }: Omit<AssistantPartProps, "onQuestionnaireAnswers" | "part"> & {
    part: ToolCallPart
  },
) {
  const input = part.input as RenderWidgetInput | undefined
  const definition = input ? getWidget(widgets, input.widget) : undefined
  if (!input || !definition) return null
  const slotName = slotNameForToolCall(part.id)
  // Only the newest render of a widget owns a live container; superseded (or reset)
  // calls collapse to a summary line instead of an empty frame.
  if (!activeSlots.has(slotName)) {
    const running = part.output == null
    return (
      <ToolCallMarker running={running}>
        {running ? "Rendering" : "Rendered"} <span className="font-mono">{input.widget}</span>
      </ToolCallMarker>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
        {definition.description}
      </div>
      <div className="rounded-xl border border-dashed p-1.5">
        {/* The light-DOM child holding the widget render projects in here. */}
        <slot name={slotName} />
      </div>
    </div>
  )
}

function QuestionnaireCallPart(
  { part, onQuestionnaireAnswers }: Pick<AssistantPartProps, "onQuestionnaireAnswers"> & {
    part: ToolCallPart
  },
) {
  if (part.output != null) {
    const skipped = (part.output as { skipped?: boolean }).skipped === true
    return (
      <Marker>
        <MarkerIcon>
          <CheckIcon />
        </MarkerIcon>
        <MarkerContent>{skipped ? "Questionnaire skipped" : "Answers sent"}</MarkerContent>
      </Marker>
    )
  }
  if (part.state !== "input-complete") return null
  const items = sanitizeQuestionnaireItems(part.input)
  if (items.length === 0) {
    return <FailureMarker>The questionnaire could not be displayed</FailureMarker>
  }
  return (
    <InlineQuestionnaire
      items={items}
      onAnswers={(answers) => onQuestionnaireAnswers(part.id, answers)}
    />
  )
}

export function AssistantPart(
  { part, widgets, activeSlots, onQuestionnaireAnswers }: AssistantPartProps,
) {
  switch (part.type) {
    case "text":
      return (
        <Bubble variant="muted">
          <BubbleContent className="whitespace-pre-wrap">{part.content}</BubbleContent>
        </Bubble>
      )
    case "thinking":
      return <div className="px-1 text-xs text-muted-foreground italic">{part.content}</div>
    case "tool-call": {
      if (part.state === "error") {
        // Failed client executions store the thrown message as `{ error }` in the output.
        const detail = (part.output as { error?: string } | null | undefined)?.error
        return (
          <FailureMarker>
            <span className="font-mono">{part.name}</span> failed
            {typeof detail === "string" && detail.length > 0 && (
              <span className="block text-muted-foreground">{detail}</span>
            )}
          </FailureMarker>
        )
      }
      if (part.name === RENDER_WIDGET_TOOL) {
        return <WidgetCallPart part={part} widgets={widgets} activeSlots={activeSlots} />
      }
      if (part.name === ASK_QUESTIONNAIRE_TOOL) {
        return <QuestionnaireCallPart part={part} onQuestionnaireAnswers={onQuestionnaireAnswers} />
      }
      const running = !isSettledToolCall(part)
      return (
        <ToolCallMarker running={running}>
          {running ? "Running" : "Ran"} <span className="font-mono">{part.name}</span>
        </ToolCallMarker>
      )
    }
    default:
      // tool-result parts mirror the output already shown on their tool-call part.
      return null
  }
}
