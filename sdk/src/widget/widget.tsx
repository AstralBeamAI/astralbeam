import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import type { CustomComponentRenderRequest, MountAstralBeamChatOptions } from "../client.ts"

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
.astralbeam-chat-custom {
  padding: 12px;
  border: 1px dashed #c0c0c0;
  border-radius: 8px;
}
.astralbeam-chat-custom-label {
  margin: 0 0 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #8a8a8a;
}
`

function ChatWidget(
  { customComponents = [], onRenderCustomComponent }: MountAstralBeamChatOptions,
) {
  const [renderRequests, setRenderRequests] = useState<CustomComponentRenderRequest[]>([])
  useEffect(() => {
    // Stands in for the agent: eventually the LLM decides when to render custom components and
    // with which props; until then, request one test render of each registered component.
    const testRenders = customComponents.map((_descriptor, componentIndex) => ({
      componentIndex,
      props: {},
      slotName: `astralbeam-custom-${componentIndex}`,
    }))
    for (const request of testRenders) onRenderCustomComponent?.(request)
    setRenderRequests(testRenders)
  }, [])
  return (
    <aside className="astralbeam-chat">
      <header className="astralbeam-chat-header">AstralBeam</header>
      <p className="astralbeam-chat-message">Hello world</p>
      {renderRequests.map((request) => (
        <div className="astralbeam-chat-custom" key={request.slotName}>
          <div className="astralbeam-chat-custom-label">
            {customComponents[request.componentIndex]?.description}
          </div>
          <slot name={request.slotName} />
        </div>
      ))}
    </aside>
  )
}

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
