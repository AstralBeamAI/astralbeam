// @vitest-environment jsdom
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { AstralBeamChat } from "./react.tsx"

function StatusCard({ status }: { status: string }) {
  return <p>Status: {status}</p>
}

test("renders requested custom components into named slots under StrictMode", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  root.render(
    <StrictMode>
      <AstralBeamChat
        customComponents={[
          { component: StatusCard, props: { status: "ok" }, description: "Host status" },
        ]}
      />
    </StrictMode>,
  )

  await vi.waitFor(() => expect(host.querySelector("[slot]")?.textContent).toBe("Status: ok"))
  // StrictMode double-mounts the widget, so repeated render requests must not duplicate renders.
  expect(host.querySelectorAll("[slot]")).toHaveLength(1)

  const target = host.firstElementChild
  const slotName = host.querySelector("[slot]")?.getAttribute("slot")
  expect(target?.shadowRoot?.querySelector(`slot[name="${slotName}"]`)).not.toBeNull()
  expect(target?.shadowRoot?.textContent).toContain("Host status")

  root.unmount()
  await vi.waitFor(() => expect(target?.shadowRoot?.childNodes.length).toBe(0))
})
