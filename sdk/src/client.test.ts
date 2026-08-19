// @vitest-environment jsdom
import { expect, test, vi } from "vitest"
import { mountAstralBeamChat } from "./client.ts"

test("mounts the widget into a shadow root and unmounts cleanly", async () => {
  const target = document.createElement("div")
  target.innerHTML = "<span>slotted content</span>"
  document.body.append(target)

  const handle = mountAstralBeamChat(target)
  const shadowRoot = target.shadowRoot
  expect(shadowRoot).not.toBeNull()

  await vi.waitFor(() => expect(shadowRoot?.textContent).toContain("Hello world"))
  expect(shadowRoot?.querySelector("slot")).not.toBeNull()
  // Light-DOM children stay in place so the widget's <slot> can project them.
  expect(target.querySelector("span")?.textContent).toBe("slotted content")

  handle.unmount()
  await vi.waitFor(() => expect(shadowRoot?.childNodes.length).toBe(0))

  // Remounting reuses the existing shadow root instead of throwing.
  const remounted = mountAstralBeamChat(target)
  await vi.waitFor(() => expect(shadowRoot?.textContent).toContain("Hello world"))
  remounted.unmount()
})
