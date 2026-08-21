import { createRoot } from "react-dom/client"
import type { MountAstralBeamChatOptions } from "../lib/client-types.ts"
import { ChatWidget } from "./chat-widget.tsx"
import { chatStyles } from "./styles.generated.ts"

export function renderChat(
  shadowRoot: ShadowRoot,
  // Created and themed by the client-entry loader, which also removes it on unmount.
  container: HTMLElement,
  options: MountAstralBeamChatOptions,
): () => void {
  const style = document.createElement("style")
  style.textContent = chatStyles
  shadowRoot.append(style)
  const root = createRoot(container)
  // The mount target (an HTMLElement per mountAstralBeamChat) hosts the slotted widget renders.
  root.render(<ChatWidget options={options} host={shadowRoot.host as HTMLElement} />)
  return () => {
    root.unmount()
    style.remove()
  }
}
