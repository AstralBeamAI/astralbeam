import { createRoot } from "react-dom/client"
import type { MountAstralBeamChatOptions } from "../client.ts"
import { ChatWidget } from "./chat-widget.tsx"
import { chatStyles } from "./styles.generated.ts"

export function renderChat(
  shadowRoot: ShadowRoot,
  options: MountAstralBeamChatOptions,
): () => void {
  const style = document.createElement("style")
  style.textContent = chatStyles
  const container = document.createElement("div")
  container.style.height = "100%"
  shadowRoot.append(style, container)
  const root = createRoot(container)
  // The mount target (an HTMLElement per mountAstralBeamChat) hosts the slotted widget renders.
  root.render(<ChatWidget options={options} host={shadowRoot.host as HTMLElement} />)
  return () => {
    root.unmount()
    style.remove()
    container.remove()
  }
}
