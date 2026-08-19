import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { AstralBeamChat } from "@astralbeam/sdk/react"

function StatusCard({ status }: { status: string }) {
  return <p>Status: {status}</p>
}

function CounterCard({ label }: { label: string }) {
  const [count, setCount] = useState(0)
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {label}: {count}
    </button>
  )
}

function App() {
  const [showChat, setShowChat] = useState(true)
  return (
    <>
      <main>
        <h1>Host React application</h1>
        <p>
          Every paragraph on this page is crimson, italic, and prefixed with a 🔥 by hostile global
          styles, and there are rules targeting the widget's own elements and class names with{" "}
          <code>!important</code>.
        </p>
        <h2>What to check</h2>
        <ol>
          <li>
            <strong>Shadow DOM isolation:</strong>{" "}
            the widget's header and "Hello world" bubble ignore all of the global styles — they
            render with the widget's own styles from inside its shadow root.
          </li>
          <li>
            <strong>Custom components:</strong> <code>StatusCard</code> and <code>CounterCard</code>
            {" "}
            are registered through the <code>customComponents</code>{" "}
            prop with descriptions for the agent; the widget (standing in for the agent) requested a
            test render of each. They run in this app's React tree — the counter's state keeps
            working — while host styles (crimson 🔥) still apply to them.
          </li>
          <li>
            <strong>Mount / unmount:</strong> the button below removes{" "}
            <code>
              &lt;AstralBeamChat&gt;
            </code>{" "}
            from the React tree, which unmounts the widget through its effect cleanup.
          </li>
        </ol>
        <button type="button" onClick={() => setShowChat(!showChat)}>
          {showChat ? "Unmount widget" : "Mount widget"}
        </button>
      </main>
      <div className="sidebar">
        {showChat && (
          <AstralBeamChat
            customComponents={[
              {
                component: StatusCard,
                props: { status: "All systems operational" },
                description: "Shows the host app's current status",
              },
              {
                component: CounterCard,
                props: { label: "Host clicks" },
                description: "An interactive counter owned by the host app",
              },
            ]}
          />
        )}
      </div>
    </>
  )
}

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("Example markup is missing the root element")
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
