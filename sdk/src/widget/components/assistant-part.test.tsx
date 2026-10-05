import type { MessagePart } from "@tanstack/ai-client"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import { RENDER_WIDGET_TOOL } from "../../core/protocol.ts"
import type { WidgetDefinition } from "../../lib/types.ts"
import { slotNameForToolCall } from "../lib/utils.ts"
import { AssistantPart } from "./assistant-part.tsx"

const render = vi.fn()
const widgets = { card: { description: "A card", render } }

function widgetPart(id: string) {
  return {
    type: "tool-call" as const,
    name: RENDER_WIDGET_TOOL,
    id,
    upstreamToolCallId: "reused-provider-id",
    arguments: '{"widget":"card","props":{}}',
    input: { widget: "card", props: {} },
    state: "complete" as const,
    output: { rendered: true },
  }
}

function renderPart(
  part: MessagePart,
  activeSlots = new Map<string, string>(),
  definitions: Record<string, WidgetDefinition> = widgets,
) {
  return renderToStaticMarkup(
    <AssistantPart
      part={part}
      apiUrl="https://example.test"
      widgets={definitions}
      toolTitles={{}}
      activeSlots={activeSlots}
      interactiveToolIds={new Set(["reused-provider-id"])}
      onQuestionnaireAnswers={() => {}}
    />,
  )
}

test("saved widgets with reused provider IDs select their own canonical slots", () => {
  const ids = ["saved:message-a:part-a", "saved:message-b:part-b"]
  const activeSlots = new Map(
    [...ids, "reused-provider-id"].map((id) => [slotNameForToolCall(id), "card"]),
  )
  for (const id of ids) {
    expect(renderPart(widgetPart(id), activeSlots)).toBe(
      `<slot name="${slotNameForToolCall(id)}"></slot>`,
    )
  }
  expect(render).not.toHaveBeenCalled()
})

test("a normalized live widget retains its explicitly associated render slot", () => {
  const part = { ...widgetPart("saved:live-message:part"), widgetRenderId: "reused-provider-id" }
  expect(renderPart(part, new Map([[slotNameForToolCall(part.widgetRenderId), "card"]]))).toBe(
    `<slot name="${slotNameForToolCall(part.widgetRenderId)}"></slot>`,
  )
})

test("missing or incompatible saved widgets remain visible without invoking a render", () => {
  const part = widgetPart("saved:message:part")
  expect(renderPart(part, new Map(), {})).toContain("This widget is unavailable.")
  expect(renderPart(part)).toContain("is unavailable.")
  expect(renderPart(part)).not.toContain("<slot")
  expect(render).not.toHaveBeenCalled()
})
