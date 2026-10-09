import { CheckIcon, WarningCircleIcon, WrenchIcon } from "@phosphor-icons/react"
import type { MessagePart } from "@tanstack/ai-client"
import type { ReactNode } from "react"
import { Bubble, BubbleContent } from "@/widget/components/ui/bubble"
import { Marker, MarkerContent, MarkerIcon } from "@/widget/components/ui/marker"
import { Spinner } from "@/widget/components/ui/spinner"
import type { WidgetRegistry, ToolResult } from "../../lib/types.ts"
import { ASK_QUESTIONNAIRE_TOOL, RENDER_WIDGET_TOOL } from "../../core/protocol.ts"
import { isSandboxTool } from "../../core/sandbox.ts"
import type { RenderWidgetInput } from "../../core/types.ts"
import type { ChatToolCallPart } from "../../core/threads.ts"
import type { QuestionnaireAnswer } from "../lib/types.ts"
import {
  formatToolJson,
  getWidget,
  isSettledToolCall,
  sanitizeQuestionnaireItems,
  slotNameForToolCall,
} from "../lib/utils.ts"
import { InlineQuestionnaire } from "./inline-questionnaire.tsx"
import { MarkdownMessage } from "./markdown-message.tsx"
import { SandboxPart } from "./sandbox-part.tsx"
import { ToolDisclosure } from "./tool-disclosure.tsx"

interface AssistantPartProps {
  readOnly?: boolean | undefined
  part: MessagePart
  apiUrl: string
  widgets: WidgetRegistry
  /** Transcript labels for tools that declared a title, keyed by tool name. */
  toolTitles: Record<string, string>
  activeSlots: ReadonlyMap<string, string>
  interactiveToolIds: ReadonlySet<string>
  interrupted?: boolean | undefined
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
      <MarkerContent className={running ? "shimmer" : undefined}>{children}</MarkerContent>
    </Marker>
  )
}

function ToolCallSection({ title, children }: { title: string; children: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-foreground">{title}</div>
      <pre className="mt-0.5 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap wrap-break-word">
        {children}
      </pre>
    </div>
  )
}

// The panel is the only place a call's raw input and output are visible; sandbox tools are the
// exception, because the widget knows what theirs mean (see `sandbox-part.tsx`).
function ToolCallDisclosure({
  part,
  title,
  failed,
  readOnly = false,
}: {
  readOnly?: boolean | undefined
  part: ChatToolCallPart
  title: string | undefined
  failed: boolean
}) {
  const settled = isSettledToolCall(part)
  const running = !readOnly && !failed && !settled
  // A declared title is prose and reads as such; a bare registry name stays monospaced.
  const label = title ? (
    <span>&ldquo;{title}&rdquo;</span>
  ) : (
    <span className="font-mono">{part.name}</span>
  )
  // Failed client executions store the thrown message as `{ error }` in the output.
  const detail = failed ? (part.output as { error?: string } | null | undefined)?.error : undefined
  return (
    <ToolDisclosure
      icon={failed ? <WarningCircleIcon /> : running ? <Spinner /> : <WrenchIcon />}
      running={running}
      label={
        failed ? (
          <>{label} failed</>
        ) : (
          <>
            {readOnly ? "Saved" : running ? "Running" : "Ran"} {label}
          </>
        )
      }
      detail={
        typeof detail === "string" && detail.length > 0 ? (
          <span className="block text-muted-foreground">{detail}</span>
        ) : undefined
      }
    >
      <div className="mt-1 flex flex-col gap-2 rounded-md border border-border bg-muted p-2">
        <ToolCallSection title="Input">{formatToolJson(part.input) || "\u2014"}</ToolCallSection>
        <ToolCallSection title="Output">
          {settled
            ? formatToolJson(part.output) || "\u2014"
            : readOnly
              ? "No saved result."
              : "Waiting for the result\u2026"}
        </ToolCallSection>
      </div>
    </ToolDisclosure>
  )
}

function WidgetCallPart({
  part,
  widgets,
  activeSlots,
}: Pick<AssistantPartProps, "widgets" | "activeSlots"> & {
  part: ChatToolCallPart
}) {
  const input =
    part.name === RENDER_WIDGET_TOOL
      ? (part.input as RenderWidgetInput | undefined)
      : part.widget
        ? { widget: part.widget, props: part.input as Record<string, unknown> }
        : undefined
  const definition = input ? getWidget(widgets, input.widget) : undefined
  const renderId = part.widgetRenderId ?? part.id
  const slotName = slotNameForToolCall(renderId)
  if (!definition || !activeSlots.has(slotName)) {
    if (isSettledToolCall(part)) {
      if (part.resultVersion === 1) {
        const result = part.output as ToolResult | undefined
        const text = result?.content
          ? result.content
              .filter((block) => block.type === "text" && typeof block.text === "string")
              .map((block) => block.text)
              .join("\n")
          : ""
        return (
          <div>
            {text && <p className="whitespace-pre-wrap">{text}</p>}
            <ToolCallDisclosure
              part={part}
              title={undefined}
              failed={part.state === "error" || result?.isError === true}
            />
          </div>
        )
      }
      return <FailureMarker>This widget is unavailable.</FailureMarker>
    }
    return <ToolCallMarker running>Preparing a widget</ToolCallMarker>
  }
  // Neither framed nor captioned: a widget render is the host app's own UI, and the
  // definition's `description` is written for the agent, not for the transcript. A bare
  // <slot> is display: contents, so the projected container is laid out by MessageContent.
  return <slot name={slotName} />
}

function QuestionnaireCallPart({
  part,
  onQuestionnaireAnswers,
}: Pick<AssistantPartProps, "onQuestionnaireAnswers"> & {
  part: ChatToolCallPart
}) {
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
  // Questionnaire items stream in over several seconds; show progress meanwhile.
  if (part.state !== "input-complete") {
    return <ToolCallMarker running>Preparing a questionnaire</ToolCallMarker>
  }
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

export function AssistantPart({
  readOnly = false,
  part,
  apiUrl,
  widgets,
  toolTitles,
  activeSlots,
  onQuestionnaireAnswers,
  interactiveToolIds,
  interrupted,
}: AssistantPartProps) {
  switch (part.type) {
    case "text":
      // Ghost, per the docs: assistant replies are unframed and take the container's full width.
      return (
        <Bubble variant="ghost">
          <BubbleContent>
            <MarkdownMessage>{part.content}</MarkdownMessage>
          </BubbleContent>
        </Bubble>
      )
    case "thinking":
      return <div className="px-1 text-xs text-muted-foreground italic">{part.content}</div>
    case "tool-call": {
      const title = Object.hasOwn(toolTitles, part.name) ? toolTitles[part.name] : undefined
      const failed =
        part.state === "error" ||
        ((part as ChatToolCallPart).resultVersion === 1 &&
          (part.output as ToolResult | undefined)?.isError === true)
      if (readOnly) {
        if (isSandboxTool(part.name) && isSettledToolCall(part))
          return <SandboxPart part={part} apiUrl={apiUrl} />
        return <ToolCallDisclosure part={part} title={title} failed={failed} readOnly />
      }
      if (interrupted && !isSettledToolCall(part))
        return <FailureMarker>This action request was interrupted.</FailureMarker>
      if ((part as ChatToolCallPart).resultOutcome === "unknown") {
        return (
          <FailureMarker>
            The outcome of {title ?? part.name} is unknown. It was not retried.
          </FailureMarker>
        )
      }
      if (!interactiveToolIds.has(part.id) && !isSettledToolCall(part)) {
        return (
          <ToolCallMarker running={false}>
            Waiting for a confirmed result from <span className="font-mono">{part.name}</span>.
          </ToolCallMarker>
        )
      }
      // Before the failure branch: a sandbox step that threw still reads better as "could not
      // write app.py" than as a generic tool failure.
      if (isSandboxTool(part.name)) {
        return <SandboxPart part={part} apiUrl={apiUrl} />
      }
      if (part.name === RENDER_WIDGET_TOOL || (part as ChatToolCallPart).widget) {
        return <WidgetCallPart part={part} widgets={widgets} activeSlots={activeSlots} />
      }
      if (failed) {
        return <ToolCallDisclosure part={part} title={title} failed />
      }
      if (part.name === ASK_QUESTIONNAIRE_TOOL) {
        return <QuestionnaireCallPart part={part} onQuestionnaireAnswers={onQuestionnaireAnswers} />
      }
      return <ToolCallDisclosure part={part} title={title} failed={false} />
    }
    default:
      // tool-result parts mirror the output already shown on their tool-call part.
      return null
  }
}
