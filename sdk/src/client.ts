export interface CustomComponentDescriptor {
  /** Tells the agent what the component does so it can decide when to render it. */
  description: string
}

export interface CustomComponentRenderRequest {
  /** Index into the `customComponents` array passed at mount. */
  componentIndex: number
  /** Props chosen for this render; the agent will eventually pick these. */
  props: Record<string, unknown>
  /** Slot to target: the host's light-DOM child needs this as its `slot` attribute. */
  slotName: string
}

export interface MountAstralBeamChatOptions {
  customComponents?: CustomComponentDescriptor[]
  /** Called whenever the widget decides one of `customComponents` should be rendered. */
  onRenderCustomComponent?: (request: CustomComponentRenderRequest) => void
}

export interface AstralBeamChatHandle {
  unmount: () => void
}

/**
 * Mounts the AstralBeam chat widget into `target`, inside a shadow root that isolates its styles.
 * The React widget loads lazily, so this entry point stays a tiny framework-agnostic loader.
 */
export function mountAstralBeamChat(
  target: HTMLElement,
  options: MountAstralBeamChatOptions = {},
): AstralBeamChatHandle {
  // attachShadow throws when called twice, so reuse the root across mount/unmount cycles.
  const shadowRoot = target.shadowRoot ?? target.attachShadow({ mode: "open" })
  let unmounted = false
  let disposeWidget: (() => void) | undefined
  import("./widget/widget.tsx").then(({ renderWidget }) => {
    if (!unmounted) disposeWidget = renderWidget(shadowRoot, options)
  })
  return {
    unmount: () => {
      unmounted = true
      disposeWidget?.()
      disposeWidget = undefined
    },
  }
}
