import { type ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
// Self-reference rather than a relative path, so this entry shares the client entry's chat
// chunk and its bundled React instead of bundling a second copy.
import { mountAstralBeamChat, type WidgetParameters } from "@astralbeam/sdk/client"

export interface WidgetDefinition {
  /** Tells the agent what the widget shows so it can decide when to render it. */
  description: string
  /** Schema of the agent-supplied props; passed to the agent verbatim. */
  parameters?: WidgetParameters
  /** Draws the widget with the agent-chosen props, in the host's own React tree. */
  render: (props: Record<string, unknown>) => ReactNode
}

export interface AstralBeamChatProps {
  /** Host-defined widgets the agent can render inline in the conversation, keyed by identifier. */
  widgets?: Record<string, WidgetDefinition>
}

interface ActiveRender {
  container: HTMLElement
  props: Record<string, unknown>
}

export function AstralBeamChat({ widgets = {} }: AstralBeamChatProps) {
  const targetRef = useRef<HTMLDivElement>(null)
  const [activeRenders, setActiveRenders] = useState<ReadonlyMap<string, ActiveRender>>(new Map())
  useEffect(() => {
    if (!targetRef.current) return
    // Registered once at mount; changing widgets afterwards is not supported yet.
    const handle = mountAstralBeamChat(targetRef.current, {
      widgets: Object.fromEntries(
        Object.entries(widgets).map(([name, { description, parameters }]) => [name, {
          description,
          // Spread keeps the key absent when unset, as exactOptionalPropertyTypes requires.
          ...(parameters !== undefined ? { parameters } : {}),
          // The chat provides a slotted container; record it and portal the JSX into it below,
          // so the widget renders in the host's React tree with working state and context.
          render: (props: Record<string, unknown>, container: HTMLElement) => {
            setActiveRenders((previous) => new Map(previous).set(name, { container, props }))
            return () => {
              setActiveRenders((previous) => {
                const next = new Map(previous)
                next.delete(name)
                return next
              })
            }
          },
        }]),
      ),
    })
    return handle.unmount
  }, [])
  return (
    <div style={{ height: "100%" }} ref={targetRef}>
      {[...activeRenders].map(([name, { container, props }]) => {
        // Read the current prop on every render, so live host state flows into the widget.
        const definition = widgets[name]
        return definition ? createPortal(definition.render(props), container, name) : null
      })}
    </div>
  )
}
