export interface CustomComponentDescriptor {
  /** Tells the agent what the component does so it can decide when to render it. */
  description: string
}

export interface CustomComponentRenderRequest {
  /** Index into the `customComponents` array passed at mount. */
  componentIndex: number
  /** Props chosen for this render; the agent will eventually pick these. */
  props: Record<string, unknown>
  /** Slot the host must target: render the component into a light-DOM child of the mount target
   * carrying this value as its `slot` attribute, and the widget projects it into place. */
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
 * Mounts the AstralBeam chat widget into `target`. The widget renders inside a shadow root so its
 * styles stay isolated from the host page. Host UI enters the widget through custom components:
 * the widget requests renders via `onRenderCustomComponent`, the host draws each one as a
 * light-DOM child of `target` with the requested `slot` attribute, and the widget projects it
 * through a named `<slot>`. The React-based widget is imported lazily, keeping this entry point a
 * tiny framework-agnostic loader.
 */
export function mountAstralBeamChat(
  target: HTMLElement,
  options: MountAstralBeamChatOptions = {},
): AstralBeamChatHandle {
  // attachShadow throws when called twice, so reuse the root across mount/unmount cycles:
  // https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#exceptions
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
