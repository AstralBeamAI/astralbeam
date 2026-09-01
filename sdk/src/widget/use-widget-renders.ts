import { useCallback, useEffect, useRef, useState } from "react"
import type { WidgetDefinition } from "../lib/types.ts"
import type { DebugLogger } from "../lib/debug.ts"
import { validateParameters } from "../core/schema.ts"
import type { RenderWidgetInput } from "../core/types.ts"
import { MAX_ACTIVE_WIDGET_RENDERS } from "./lib/constants.ts"
import { getWidget, slotNameForToolCall } from "./lib/utils.ts"

interface ActiveWidgetRender {
  /** Kept so an update that drops the widget can dispose renders it can no longer resolve. */
  widget: string
  container: HTMLElement
  cleanup: (() => void) | undefined
}

function disposeWidgetRender({ container, cleanup }: ActiveWidgetRender) {
  cleanup?.()
  container.remove()
}

/**
 * Owns the live widget renders: light-DOM containers slotted into the transcript, keyed by tool
 * call so several renders of one widget coexist and only a repeat of the same call replaces its
 * own render. `activeSlots` holds the slot names currently backed by a live render — the
 * transcript renders a real <slot> only for these, a summary marker otherwise.
 */
export function useWidgetRenders(
  widgets: Record<string, WidgetDefinition>,
  host: HTMLElement,
  debug: DebugLogger | undefined,
) {
  const [activeSlots, setActiveSlots] = useState<ReadonlySet<string>>(new Set())
  const activeRenders = useRef(new Map<string, ActiveWidgetRender>())
  // Reset, the active-render cap, and cleanup after a widget is unregistered differ only in which
  // renders they select, so they share one path: dispose, forget, and drop the slot so the
  // transcript entry falls back to a summary marker. Returns how many went.
  const discardRenders = (discard: (render: ActiveWidgetRender) => boolean) => {
    const dropped: string[] = []
    // Deleting the current entry while iterating a Map is well defined, and insertion order makes
    // a size-based predicate discard oldest-first.
    for (const [toolCallId, render] of activeRenders.current) {
      if (!discard(render)) continue
      disposeWidgetRender(render)
      activeRenders.current.delete(toolCallId)
      dropped.push(slotNameForToolCall(toolCallId))
    }
    if (dropped.length > 0) {
      setActiveSlots((current) => {
        const next = new Set(current)
        for (const slot of dropped) next.delete(slot)
        return next
      })
    }
    return dropped.length
  }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      discardRenders(() => true)
    }
  }, [])

  // `renderWidget` has to stay referentially stable or the tool set built on it would rebuild on
  // every render, so it reads the widgets and the logger through refs instead of capturing them:
  // a render can be requested many turns after the update that declared the widget.
  const widgetsRef = useRef(widgets)
  widgetsRef.current = widgets
  const debugRef = useRef(debug)
  debugRef.current = debug

  const renderWidget = useCallback(
    async ({ widget, props }: RenderWidgetInput, toolCallId: string) => {
      const debug = debugRef.current
      debug?.("widget", `agent requested widget "${widget}"`, { toolCallId, props })
      const definition = getWidget(widgetsRef.current, widget)
      if (!definition) throw new Error(`Unknown widget "${widget}"`)
      const validated = await validateParameters(definition.parameters, props ?? {})
      if (validated == null) {
        debug?.("error", `props for widget "${widget}" failed validation`, { props })
        throw new Error(`Props for widget "${widget}" failed validation`)
      }
      if (!mounted.current) throw new Error("The chat is no longer mounted")
      const slotName = slotNameForToolCall(toolCallId)
      const previous = activeRenders.current.get(toolCallId)
      if (previous) {
        debug?.("widget", `replacing previous render of "${widget}"`, { toolCallId })
        disposeWidgetRender(previous)
      }
      // The container is a light-DOM child of the shadow host, so the <slot> rendered
      // in the transcript projects it into the conversation.
      const container = document.createElement("div")
      container.slot = slotName
      host.append(container)
      const cleanup = definition.render(validated, container)
      activeRenders.current.set(toolCallId, { widget, container, cleanup: cleanup ?? undefined })
      // Insertion order makes the size predicate evict oldest-first; their transcript
      // entries collapse to a summary marker.
      const evicted = discardRenders(() => activeRenders.current.size > MAX_ACTIVE_WIDGET_RENDERS)
      if (evicted > 0) {
        debug?.("widget", `evicted ${evicted} widget render(s) past the active cap`, {
          cap: MAX_ACTIVE_WIDGET_RENDERS,
        })
      }
      setActiveSlots((current) => new Set(current).add(slotName))
      debug?.("widget", `widget "${widget}" rendered`, { slotName })
      return { widget, rendered: true }
    },
    [host],
  )

  // A widget dropped by an update leaves its render unreachable: the transcript can no longer
  // resolve the definition, so the container would linger in the host's DOM behind a slot that
  // is never rendered. Those entries fall back to the summary marker instead.
  useEffect(() => {
    const orphaned = discardRenders((render) => !getWidget(widgets, render.widget))
    if (orphaned > 0) {
      debug?.("widget", `disposed ${orphaned} render(s) of widgets no longer registered`)
    }
  }, [widgets, debug])

  return { activeSlots, renderWidget, discardAllRenders: () => discardRenders(() => true) }
}
