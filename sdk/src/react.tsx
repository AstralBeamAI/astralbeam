import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
// Self-reference rather than a relative path, so this entry shares the client entry's chat
// chunk and its bundled React instead of bundling a second copy.
import {
  type AstralBeamChatColorScheme,
  type AstralBeamChatHandle,
  type AstralBeamChatTheme,
  mountAstralBeamChat,
  type ToolDefinition,
  type WidgetDefinition as ClientWidgetDefinition,
} from "@astralbeam/sdk/client"
// A constant-only module, safe to import relatively: it pulls no React into this entry.
import { DEFAULT_COLOR_SCHEME } from "./lib/client-constants.ts"

export type { AstralBeamChatColorScheme, AstralBeamChatTheme, ToolDefinition }

export interface WidgetDefinition extends Omit<ClientWidgetDefinition, "render"> {
  /** Draws the widget with the agent-chosen props, in the host's own React tree. */
  render: (props: Record<string, unknown>) => ReactNode
}

export interface AstralBeamChatProps {
  /** Name shown in the widget's header; prop changes apply immediately. Default `"AstralBeam"`. */
  title?: string
  /** URL of the AstralBeam chat endpoint the widget streams from. Default `"/api/chat"`. */
  chatEndpoint?: string
  /** Application endpoint that mints a short-lived chat JWT; omit for guest chat. */
  authEndpoint?: string
  /** Host-specific instructions the endpoint appends to the agent's system prompt. */
  systemPrompt?: string
  /** Host-defined tools the agent can call, executed in the host's React app, keyed by name. */
  tools?: Record<string, ToolDefinition>
  /** Host-defined widgets the agent can render inline in the conversation, keyed by identifier. */
  widgets?: Record<string, WidgetDefinition>
  /** Color scheme of the chat widget; prop changes apply immediately. Default `"system"`. */
  colorScheme?: AstralBeamChatColorScheme
  /** Custom values for the widget's theming CSS variables, per color scheme; changes apply immediately. */
  theme?: AstralBeamChatTheme | undefined
  /**
   * Logs every SDK action to the browser console with UTC timestamps and full payloads,
   * and asks the endpoint to log its side of the run too; prop changes apply immediately.
   */
  debug?: boolean
}

interface ActiveRender {
  widget: string
  container: HTMLElement
  props: Record<string, unknown>
}

export function AstralBeamChat(
  {
    title,
    chatEndpoint,
    authEndpoint,
    systemPrompt,
    tools,
    widgets = {},
    colorScheme = DEFAULT_COLOR_SCHEME,
    theme,
    debug,
  }: AstralBeamChatProps,
) {
  const targetRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<AstralBeamChatHandle | null>(null)
  const [activeRenders, setActiveRenders] = useState<ReadonlyMap<string, ActiveRender>>(new Map())
  // The chat calls tools long after mount, so route execution through the latest prop value —
  // otherwise every execute would close over the first render's host state.
  const toolsRef = useRef(tools)
  useEffect(() => {
    toolsRef.current = tools
  })
  // The chat keeps one render per tool call, so several renders of the same widget can be live
  // at once (a listing that renders a card per item); each needs its own portal and React key.
  const nextRenderKey = useRef(0)
  // Memoized on the props they adapt: the update effect below ships them to the chat, and a fresh
  // object every render would rebuild the declared tool set on every render along with it.
  const hostTools = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(tools ?? {}).map(([name, definition]) => [name, {
          ...definition,
          execute: (input: Record<string, unknown>) => {
            const current = toolsRef.current?.[name]
            if (!current) throw new Error(`Tool "${name}" is no longer registered`)
            return current.execute(input)
          },
        }]),
      ),
    [tools],
  )
  const hostWidgets = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(widgets).map(([name, definition]) => [name, {
          ...definition,
          // The chat provides a slotted container; record it and portal the JSX into it below,
          // so the widget renders in the host's React tree with working state and context.
          render: (props: Record<string, unknown>, container: HTMLElement) => {
            const key = `astralbeam-render-${nextRenderKey.current++}`
            setActiveRenders((previous) =>
              new Map(previous).set(key, { widget: name, container, props })
            )
            return () => {
              setActiveRenders((previous) => {
                const next = new Map(previous)
                next.delete(key)
                return next
              })
            }
          },
        }]),
      ),
    [widgets],
  )
  // The one set of updatable options, so mounting and updating cannot drift apart as options are
  // added. Memoized because the update effect keys off it.
  const live = useMemo(
    () => ({
      title,
      systemPrompt,
      colorScheme,
      theme,
      debug,
      tools: hostTools,
      widgets: hostWidgets,
    }),
    [title, systemPrompt, colorScheme, theme, debug, hostTools, hostWidgets],
  )
  const liveRef = useRef(live)
  liveRef.current = live
  useEffect(() => {
    if (!targetRef.current) return
    // Mounted once; transport endpoints cannot be updated afterwards.
    const handle = mountAstralBeamChat(targetRef.current, {
      ...liveRef.current,
      chatEndpoint,
      authEndpoint,
    })
    handleRef.current = handle
    return () => {
      handleRef.current = null
      handle.unmount()
    }
  }, [])
  // Re-applies the initial values harmlessly; afterwards, every prop change retunes the widget.
  useEffect(() => {
    handleRef.current?.update(live)
  }, [live])
  return (
    <div style={{ height: "100%" }} ref={targetRef}>
      {[...activeRenders].map(([key, { widget, container, props }]) => {
        // Read the current prop on every render, so live host state flows into the widget.
        const definition = widgets[widget]
        return definition ? createPortal(definition.render(props), container, key) : null
      })}
    </div>
  )
}
