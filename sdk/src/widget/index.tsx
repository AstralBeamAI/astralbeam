import { createAstralBeamChat } from "../core/session.ts"
import { createDebugCallbacks } from "./lib/stream-debug.ts"
import { createRoot } from "react-dom/client"
import type { MountAstralBeamChatOptions } from "../lib/types.ts"
import { createDebugLogger } from "../lib/debug.ts"
import { ChatWidget } from "./chat-widget.tsx"
import { TooltipProvider } from "./components/ui/tooltip"
import { bridgeHostStyle } from "./host-style.ts"
import { chatStyles } from "./styles.generated.ts"

export interface ChatHandle {
  update: (options: MountAstralBeamChatOptions) => void
  dispose: () => void
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
  style.textContent = chatStyles + (options.customCss ?? "")
  shadowRoot.append(style)
  // Tracks the options the widget last rendered with, so the style bridge's logger follows a
  // `debug` update the same way the widget's own does.
  let live = options
  const disposeHostStyle = bridgeHostStyle(shadowRoot, () => createDebugLogger(live.debug))
  const root = createRoot(container)
  let streamCallbacks = createDebugCallbacks(createDebugLogger(options.debug))
  const ownedChat = options.chat ? undefined : createAstralBeamChat({ ...options, streamCallbacks })
  // The mount target (an HTMLElement per mountAstralBeamChat) hosts the slotted widget renders.
  const render = (nextOptions: MountAstralBeamChatOptions) => {
    if (live.customCss !== nextOptions.customCss) {
      style.textContent = chatStyles + (nextOptions.customCss ?? "")
    }
    if (live.debug !== nextOptions.debug)
      streamCallbacks = createDebugCallbacks(createDebugLogger(nextOptions.debug))
    live = nextOptions
    ownedChat?.updateOptions({ ...nextOptions, streamCallbacks })
    root.render(
      <TooltipProvider delay={400}>
        <ChatWidget
          chat={nextOptions.chat ?? ownedChat!}
          options={nextOptions}
          host={shadowRoot.host as HTMLElement}
        />
      </TooltipProvider>,
    )
  }
  render(options)
  return {
    // Rendering the same element type into the same root updates it in place, so the transcript,
    // the chat session, and live widget renders all survive an update.
    update: render,
    dispose: () => {
      root.unmount()
      ownedChat?.dispose()
      disposeHostStyle()
      style.remove()
    },
  }
}
