export interface AstralBeamChatHandle {
  unmount: () => void
}

/**
 * Mounts the AstralBeam chat widget into `target`. The widget renders inside a shadow root so its
 * styles stay isolated from the host page, and any light-DOM children already inside `target` are
 * projected into the widget's `<slot>`. The React-based widget is imported lazily, keeping this
 * entry point a tiny framework-agnostic loader.
 */
export function mountAstralBeamChat(target: HTMLElement): AstralBeamChatHandle {
  // attachShadow throws when called twice, so reuse the root across mount/unmount cycles:
  // https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#exceptions
  const shadowRoot = target.shadowRoot ?? target.attachShadow({ mode: "open" })
  let unmounted = false
  let disposeWidget: (() => void) | undefined
  import("./widget/widget.tsx").then(({ renderWidget }) => {
    if (!unmounted) disposeWidget = renderWidget(shadowRoot)
  })
  return {
    unmount: () => {
      unmounted = true
      disposeWidget?.()
      disposeWidget = undefined
    },
  }
}
