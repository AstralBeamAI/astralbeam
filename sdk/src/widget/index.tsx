import { createRoot } from "react-dom/client"
import type { MountAstralBeamChatOptions } from "../lib/types.ts"
import { createDebugLogger } from "../lib/debug.ts"
import { ChatWidget } from "./chat-widget.tsx"
import { bridgeHostStyle } from "./host-style.ts"
import { chatStyles } from "./styles.generated.ts"

export interface ChatHandle {
  update: (options: MountAstralBeamChatOptions) => void
  reset: () => void
  stop: () => void
  dispose: () => void
}

/**
 * The widget's imperative surface, registered by ChatWidget from an effect. Plain mutable data
 * rather than a React ref so the loader can hold it before the first render commits.
 */
export interface ChatController {
  reset?: (() => void) | undefined
  stop?: (() => void) | undefined
}

export function renderChat(
  shadowRoot: ShadowRoot,
  // Created and themed by the client-entry loader, which also removes it on unmount.
  container: HTMLElement,
  // Owned by the loader, which merges updates into it and pushes the result back through the
  // returned handle.
  options: MountAstralBeamChatOptions,
): ChatHandle {
  const style = document.createElement("style")
  style.textContent = chatStyles
  shadowRoot.append(style)
  // Tracks the options the widget last rendered with, so the style bridge's logger follows a
  // `debug` update the same way the widget's own does.
  let live = options
  const disposeHostStyle = bridgeHostStyle(shadowRoot, () => createDebugLogger(live.debug))
  const root = createRoot(container)
  const controller: ChatController = {}
  // The mount target (an HTMLElement per mountAstralBeamChat) hosts the slotted widget renders.
  const render = (nextOptions: MountAstralBeamChatOptions) => {
    live = nextOptions
    root.render(
      <ChatWidget
        options={nextOptions}
        host={shadowRoot.host as HTMLElement}
        controller={controller}
      />,
    )
  }
  render(options)
  return {
    // Rendering the same element type into the same root updates it in place, so the transcript,
    // the chat session, and live widget renders all survive an update.
    update: render,
    reset: () => controller.reset?.(),
    stop: () => controller.stop?.(),
    dispose: () => {
      root.unmount()
      disposeHostStyle()
      style.remove()
    },
  }
}
