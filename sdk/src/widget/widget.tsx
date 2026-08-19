import { createRoot } from "react-dom/client"

const widgetStyles = `
:host {
  display: block;
}
.astralbeam-chat {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  padding: 16px;
  border-left: 1px solid #e2e2e2;
  background: #ffffff;
  color: #171717;
  font-family: system-ui, sans-serif;
  font-style: normal;
}
.astralbeam-chat-header {
  padding: 10px 14px;
  border-radius: 8px;
  background: #4f46e5;
  color: #ffffff;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.astralbeam-chat-message {
  margin: 0;
  padding: 10px 14px;
  border-radius: 12px 12px 12px 2px;
  background: #eef2ff;
  color: #312e81;
  align-self: flex-start;
}
.astralbeam-chat-slot {
  margin-top: auto;
  padding: 12px;
  border: 1px dashed #c0c0c0;
  border-radius: 8px;
}
.astralbeam-chat-slot-label {
  margin: 0 0 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #8a8a8a;
}
`

function ChatWidget() {
  return (
    <aside className="astralbeam-chat">
      <header className="astralbeam-chat-header">AstralBeam</header>
      <p className="astralbeam-chat-message">Hello world</p>
      <div className="astralbeam-chat-slot">
        <div className="astralbeam-chat-slot-label">Slotted host content</div>
        <slot />
      </div>
    </aside>
  )
}

export function renderWidget(shadowRoot: ShadowRoot): () => void {
  const style = document.createElement("style")
  style.textContent = widgetStyles
  const container = document.createElement("div")
  container.style.height = "100%"
  shadowRoot.append(style, container)
  const root = createRoot(container)
  root.render(<ChatWidget />)
  return () => {
    root.unmount()
    style.remove()
    container.remove()
  }
}
