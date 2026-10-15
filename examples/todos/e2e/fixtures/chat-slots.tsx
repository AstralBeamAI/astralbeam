import { useState } from "react"
import { createRoot } from "react-dom/client"
import { AstralBeamChat } from "@astralbeam/sdk/react"
import { ASTRALBEAM_API_URL, CHAT_AGENT_ID } from "../../src/lib/config.ts"

function ChatSlots() {
  const [actions, setActions] = useState(0)
  const countAction = () => setActions((count) => count + 1)
  return (
    <main>
      <h1>Host application</h1>
      <aside className="chat-sidebar" style={{ width: 320, height: 640, margin: 40 }}>
        <AstralBeamChat
          apiUrl={ASTRALBEAM_API_URL}
          agentId={CHAT_AGENT_ID}
          showConversationTitle
          fetchAstralBeamToken={{ url: "/api/astralbeam/token" }}
          header={<strong>Task helper</strong>}
          headerActions={
            <button type="button" onClick={countAction}>
              Help
            </button>
          }
          empty={<p>Host actions: {actions}</p>}
          composerActions={
            <button type="button" onClick={countAction}>
              Context
            </button>
          }
        />
      </aside>
    </main>
  )
}

createRoot(document.getElementById("fixture-root")!).render(<ChatSlots />)
