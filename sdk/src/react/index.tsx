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
  type AstralBeamChatAuthTokenHeaders,
  type AstralBeamChatColorScheme,
  type AstralBeamChatHandle,
  type AstralBeamChatSlotRenderer,
  type AstralBeamChatTheme,
  defineTool,
  type InferParameters,
  type JsonSchemaObject,
  mountAstralBeamChat,
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

export type {
  AstralBeamChatAttachmentOptions,
  AstralBeamChatAuthTokenHeaders,
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
 * state with no markup, for hosts that own their whole chat UI. Transport identity (endpoints,
 * agent) and the declared tool/widget set are fixed for the component's lifetime — remount with
 * a React `key` to change them — but `execute` and `onRenderWidget` read the latest render, so
 * ordinary closures over props and state stay live. Whether a widget renderer exists at all is
 * part of the declared surface and is read at mount.
 */
export function useAstralBeamChat(options: AstralBeamChatCoreOptions): UseAstralBeamChatResult {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [core] = useState(() =>
    createAstralBeamChat({
      ...options,
      tools: Object.fromEntries(
        Object.entries(options.tools ?? {}).map(([name, definition]) => [name, {
          ...definition,
          execute: (input: Record<string, unknown>) => {
            const current = optionsRef.current.tools?.[name]
            if (!current) throw new Error(`Tool "${name}" is no longer registered`)
            return current.execute(input)
          },
        }]),
      ),
      // Wrapped only when a renderer exists at mount: an unconditional wrapper would make the
      // core report rendered: true for hosts that declared widgets without rendering them.
      onRenderWidget: options.onRenderWidget === undefined
        ? undefined
        : (request) => optionsRef.current.onRenderWidget?.(request),
    })
  )
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

export interface AstralBeamChatProps {
  /**
   * Public ID of the organization-owned agent, fixed for this mounted chat. Omit it to use the
   * organization's default agent, which the dashboard's agents page selects.
   */
  agentId?: string
  /** Name shown in the widget's header; prop changes apply immediately. Default `"AstralBeam"`. */
  title?: string
  /**
   * Shows the widget's header with the title and the reset button; `false` hides both and gives
   * the transcript the full height. Prop changes apply immediately. Default `true`.
   */
  showHeader?: boolean
  /** Replaces the header's content with the host's own React content; `showHeader` still applies. */
  header?: ReactNode
  /** Replaces the empty-transcript state with the host's own React content. */
  empty?: ReactNode
  /** Extra host controls at the end of the composer's button row, next to send. */
  composerActions?: ReactNode
  /** Headline shown on the empty transcript; prop changes apply immediately. Default `"Ask the assistant"`. */
  emptyTitle?: string
  /** Subtitle under the empty transcript's headline; prop changes apply immediately. */
  emptyDescription?: string
  /** Base URL of the AstralBeam API; the widget calls `/chat` under it. Default the hosted cloud. */
  apiUrl?: string
  /** Application endpoint that mints a short-lived chat JWT. Default `"/api/astralbeam/token"`. */
  authTokenUrl?: string
  /**
   * Extra headers for the token request, for a backend on another origin that authenticates with a
   * bearer token or custom header instead of cookies. Always read from the latest render, so an
   * inline object or callback over current auth state is fine and needs no memoization.
   */
  authTokenHeaders?: AstralBeamChatAuthTokenHeaders
  /** Host-defined tools the agent can call, executed in the host's React app, keyed by name. */
  tools?: Record<string, ToolDefinition>
  /** Host-defined widgets the agent can render inline in the conversation, keyed by identifier. */
  widgets?: Record<string, WidgetDefinition>
  /** Color scheme of the chat widget; prop changes apply immediately. Default `"system"`. */
  colorScheme?: AstralBeamChatColorScheme
  /** Custom values for the widget's theming CSS variables, per color scheme; changes apply immediately. */
  theme?: AstralBeamChatTheme | undefined
  /** File attachments in the composer, on by default; `false` turns them off. */
  attachments?: boolean | AstralBeamChatAttachmentOptions
  /** Shows the collected sandbox panel (files with downloads, command log) above the composer. Default `false`. */
  sandboxPanel?: boolean
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
      authTokenUrl,
      authTokenHeaders,
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
    // Same reason, and the widget mints tokens for as long as it lives: headers frozen at mount
    // would keep sending the first render's credential once the host's session rotates.
    const authTokenHeadersRef = useRef(authTokenHeaders)
    useEffect(() => {
      authTokenHeadersRef.current = authTokenHeaders
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
      // Mounted once; transport endpoints cannot be updated afterwards.
      const handle = mountAstralBeamChat(targetRef.current, {
        ...liveRef.current,
        agentId,
        apiUrl,
        authTokenUrl,
        // Always a function, so a new inline object or callback each render is neither a changed
        // mount-fixed option nor a stale credential.
        ...(authTokenHeadersRef.current
          ? {
            authTokenHeaders: () => {
              const current = authTokenHeadersRef.current
              return typeof current === "function" ? current() : current ?? {}
            },
          }
          : {}),
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
