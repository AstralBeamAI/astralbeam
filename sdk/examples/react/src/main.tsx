import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { AstralBeamChat } from "@astralbeam/sdk/react"

function SlottedPanel() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <p>Custom React component from the host app</p>
      <button type="button" onClick={() => setCount(count + 1)}>
        Host state works in here: {count}
      </button>
    </div>
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
            <strong>Slot projection:</strong>{" "}
            the crimson 🔥 panel inside the widget's dashed "slotted host content" box is the{" "}
            <code>SlottedPanel</code> component passed as <code>children</code> to{" "}
            <code>&lt;AstralBeamChat&gt;</code>; it keeps host styling and its counter proves host
            React state keeps working inside the widget.
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
          <AstralBeamChat>
            <SlottedPanel />
          </AstralBeamChat>
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
