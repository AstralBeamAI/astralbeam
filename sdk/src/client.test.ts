// @vitest-environment jsdom
import { expect, test, vi } from "vitest"
import { type CustomComponentRenderRequest, mountAstralBeamChat } from "./client.ts"

test("mounts the widget, requests custom component renders, and unmounts cleanly", async () => {
  const target = document.createElement("div")
  document.body.append(target)
  const requests: CustomComponentRenderRequest[] = []

  const handle = mountAstralBeamChat(target, {
    customComponents: [{ description: "Test panel" }],
    onRenderCustomComponent: (request) => {
      requests.push(request)
      const container = document.createElement("div")
      container.setAttribute("slot", request.slotName)
      container.textContent = "host rendered content"
      target.append(container)
    },
  })
  const shadowRoot = target.shadowRoot
  expect(shadowRoot).not.toBeNull()

  await vi.waitFor(() => expect(shadowRoot?.textContent).toContain("Hello world"))
  expect(requests).toHaveLength(1)
  expect(requests[0]?.componentIndex).toBe(0)
  // The widget shows the component's description and projects the host's slotted render.
  expect(shadowRoot?.textContent).toContain("Test panel")
  expect(shadowRoot?.querySelector(`slot[name="${requests[0]?.slotName}"]`)).not.toBeNull()
  // The host's render stays in the light DOM, where the named <slot> projects it.
  expect(target.querySelector("[slot]")?.textContent).toBe("host rendered content")

  handle.unmount()
  await vi.waitFor(() => expect(shadowRoot?.childNodes.length).toBe(0))

  // Remounting reuses the existing shadow root instead of throwing.
  const remounted = mountAstralBeamChat(target)
  await vi.waitFor(() => expect(shadowRoot?.textContent).toContain("Hello world"))
  remounted.unmount()
})
