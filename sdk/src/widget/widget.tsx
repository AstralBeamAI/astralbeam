import { createRoot } from "react-dom/client"
import type { MountAstralBeamChatOptions } from "../client.ts"
import { ChatWidget } from "./chat.tsx"
import { widgetStyles } from "./styles.generated.ts"

export function renderWidget(
  shadowRoot: ShadowRoot,
  options: MountAstralBeamChatOptions,
): () => void {
  const style = document.createElement("style")
  style.textContent = widgetStyles
  const container = document.createElement("div")
  container.style.height = "100%"
  shadowRoot.append(style, container)
  const root = createRoot(container)
  root.render(<ChatWidget {...options} />)
  return () => {
    root.unmount()
    style.remove()
    container.remove()
  }
}
