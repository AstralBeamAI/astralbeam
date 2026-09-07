import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { createPortal } from "react-dom"
// Self-reference rather than a relative path, so this entry shares the client entry's chat
// chunk and its bundled React instead of bundling a second copy.
import {
  type AstralBeamChatAttachmentOptions,
  type AstralBeamChatAuthTokenRequest,
  type AstralBeamChatAuthTokenSource,
  type AstralBeamChatColorScheme,
  type AstralBeamChatHandle,
  type AstralBeamChatSlotRenderer,
  type AstralBeamChatTheme,
  defineTool,
  type InferParameters,
  type JsonSchemaObject,
  mountAstralBeamChat,
  type MountAstralBeamChatOptions,
  type ParametersSchema,
  type ToolDefinition,
  type WidgetDefinition as ClientWidgetDefinition,
} from "@astralbeam/sdk/client"
// A constant-only module, safe to import relatively: it pulls no React into this entry.
import { DEFAULT_COLOR_SCHEME } from "../lib/constants.ts"
// The headless core is bundled into this entry; it binds to no React of its own.
import {
  type AstralBeamChatCore,
  type AstralBeamChatCoreOptions,
  type AstralBeamChatState,
  createAstralBeamChat,
} from "../core/index.ts"
// Not part of the public core surface: the option list this wrapper has to watch.
import { CORE_OPTION_KEYS } from "../core/session.ts"

export type {
  AstralBeamChatAttachmentOptions,
  AstralBeamChatAuthTokenRequest,
  AstralBeamChatAuthTokenSource,
  AstralBeamChatColorScheme,
  AstralBeamChatTheme,
  InferParameters,
  ParametersSchema,
  ToolDefinition,
}
export { defineTool }

export interface WidgetDefinition extends Omit<ClientWidgetDefinition, "render"> {
  /** Draws the widget with the agent-chosen props, in the host's own React tree. */
  render: (props: Record<string, unknown>) => ReactNode
}

export interface TypedReactWidgetDefinition<S extends ParametersSchema = JsonSchemaObject> {
  description: string
  parameters?: S
  render: (props: InferParameters<S>) => ReactNode
}

/** Declares a host widget; a Standard Schema `parameters` types (and validates) `render`'s props. */
export function defineWidget<const S extends ParametersSchema = JsonSchemaObject>(
  widget: TypedReactWidgetDefinition<S>,
): WidgetDefinition {
  // The chat validates a Standard Schema before render runs, so the narrowed type holds.
  return widget as unknown as WidgetDefinition
}

export type { AstralBeamChatCore, AstralBeamChatCoreOptions, AstralBeamChatState }

/** Everything `useAstralBeamChat` returns: the live state plus the session's actions. */
export interface UseAstralBeamChatResult extends AstralBeamChatState {
  sendMessage: AstralBeamChatCore["sendMessage"]
  addToolResult: AstralBeamChatCore["addToolResult"]
  stop: () => void
  reload: () => Promise<void>
  reset: () => void
  /** The underlying headless session, for anything the flattened surface does not carry. */
  core: AstralBeamChatCore
}

/**
 * The headless chat session as a React hook: authentication, transport, tools, and transcript
 * state with no markup, for hosts that own their whole chat UI. Every option follows the props it
 * is given, keeping the transcript and the chat session, so ordinary closures over props and
 * state stay live and nothing needs a remount.
 */
export function useAstralBeamChat(options: AstralBeamChatCoreOptions): UseAstralBeamChatResult {
  // https://react.dev/reference/react/useRef#caveats — one session per committed mount, built on
  // first render, not a `useState` initializer; Strict Mode's render probe can still make a second.
  const coreRef = useRef<AstralBeamChatCore | null>(null)
  coreRef.current ??= createAstralBeamChat(options)
  const core = coreRef.current
  // Keyed off every core option, `streamCallbacks` included: the session reads them per event, so
  // a change that never reaches `updateOptions` would leave it calling the previous closures.
  useEffect(() => {
    core.updateOptions(options)
  }, [core, ...CORE_OPTION_KEYS.map((key) => options[key])])
  useEffect(() => () => core.dispose(), [core])
  const state = useSyncExternalStore(core.subscribe, core.getState, core.getState)
  return {
    ...state,
    sendMessage: core.sendMessage,
    addToolResult: core.addToolResult,
    stop: core.stop,
    reload: core.reload,
    reset: core.reset,
    core,
  }
}

/** Imperative surface of a mounted `<AstralBeamChat>`, for hosts that draw their own controls. */
export interface AstralBeamChatRef {
  /** Clears the conversation: transcript, drafts, attachments, and live widget renders. */
  reset: () => void
  /** Stops the in-flight generation, if any; the transcript keeps what already streamed. */
  stop: () => void
}

/**
 * Every mount option as a prop, with the DOM-rendering fields replaced by React ones: a widget
 * renders JSX, and the chrome slots take nodes instead of renderers. The shared options are
 * documented once, on `MountAstralBeamChatOptions`.
 */
export interface AstralBeamChatProps extends Omit<MountAstralBeamChatOptions, "widgets" | "slots"> {
  /** Host-defined widgets the agent can render inline in the conversation, keyed by identifier. */
  widgets?: Record<string, WidgetDefinition> | undefined
  /** Replaces the header's content with the host's own React content; `showHeader` still applies. */
  header?: ReactNode
  /** Replaces the empty-transcript state with the host's own React content. */
  empty?: ReactNode
  /** Extra host controls at the end of the composer's button row, next to send. */
  composerActions?: ReactNode
}

interface ActiveRender {
  widget: string
  container: HTMLElement
  props: Record<string, unknown>
}

const CHROME_SLOT_NAMES = ["header", "empty", "composerActions"] as const
type ChromeSlotName = (typeof CHROME_SLOT_NAMES)[number]

export const AstralBeamChat = forwardRef<AstralBeamChatRef, AstralBeamChatProps>(
  function AstralBeamChat(
    {
      agentId,
      title,
      showHeader,
      header,
      empty,
      composerActions,
      emptyTitle,
      emptyDescription,
      apiUrl,
      fetchChatAuthToken,
      tools,
      widgets = {},
      colorScheme = DEFAULT_COLOR_SCHEME,
      theme,
      attachments,
      sandboxPanel,
      debug,
    },
    ref,
  ) {
    const targetRef = useRef<HTMLDivElement>(null)
    const handleRef = useRef<AstralBeamChatHandle | null>(null)
    const [activeRenders, setActiveRenders] = useState<ReadonlyMap<string, ActiveRender>>(
      new Map(),
    )
    useImperativeHandle(ref, () => ({
      reset: () => handleRef.current?.reset(),
      stop: () => handleRef.current?.stop(),
    }), [])
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
    // Chrome slot content lives in the host tree through the same portal mechanism as widget
    // renders. The renderers key on presence only, so content updates flow through the portal
    // without re-running the renderer (which would tear down and rebuild the projected DOM).
    const [chromeContainers, setChromeContainers] = useState<
      ReadonlyMap<ChromeSlotName, HTMLElement>
    >(new Map())
    const hasHeader = header !== undefined
    const hasEmpty = empty !== undefined
    const hasComposerActions = composerActions !== undefined
    const chromeSlots = useMemo(() => {
      const build = (name: ChromeSlotName): AstralBeamChatSlotRenderer => (container) => {
        setChromeContainers((previous) => new Map(previous).set(name, container))
        return () => {
          setChromeContainers((previous) => {
            const next = new Map(previous)
            next.delete(name)
            return next
          })
        }
      }
      return {
        ...(hasHeader ? { header: build("header") } : {}),
        ...(hasEmpty ? { empty: build("empty") } : {}),
        ...(hasComposerActions ? { composerActions: build("composerActions") } : {}),
      }
    }, [hasHeader, hasEmpty, hasComposerActions])
    // The one set of updatable options, so mounting and updating cannot drift apart as options are
    // added. Memoized because the update effect keys off it.
    const live = useMemo(
      () => ({
        agentId,
        apiUrl,
        fetchChatAuthToken,
        title,
        showHeader,
        emptyTitle,
        emptyDescription,
        colorScheme,
        theme,
        attachments,
        sandboxPanel,
        debug,
        tools: hostTools,
        widgets: hostWidgets,
        slots: chromeSlots,
      }),
      [
        agentId,
        apiUrl,
        fetchChatAuthToken,
        title,
        showHeader,
        emptyTitle,
        emptyDescription,
        colorScheme,
        theme,
        attachments,
        sandboxPanel,
        debug,
        hostTools,
        hostWidgets,
        chromeSlots,
      ],
    )
    const liveRef = useRef(live)
    liveRef.current = live
    useEffect(() => {
      if (!targetRef.current) return
      const handle = mountAstralBeamChat(targetRef.current, liveRef.current)
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
    // Read current props at render time so live host state flows into every projected slot.
    const chromeContent: Record<ChromeSlotName, ReactNode> = {
      header,
      empty,
      composerActions,
    }
    return (
      <div style={{ height: "100%" }} ref={targetRef}>
        {[...activeRenders].map(([key, { widget, container, props }]) => {
          // Read the current prop on every render, so live host state flows into the widget.
          const definition = widgets[widget]
          return definition ? createPortal(definition.render(props), container, key) : null
        })}
        {[...chromeContainers].map(([name, container]) =>
          createPortal(chromeContent[name], container, `astralbeam-chrome-${name}`)
        )}
      </div>
    )
  },
)
