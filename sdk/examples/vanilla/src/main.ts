import {
  type AstralBeamChatHandle,
  type CustomComponentRenderRequest,
  mountAstralBeamChat,
  type MountAstralBeamChatOptions,
} from "@astralbeam/sdk/client"

const target = document.querySelector<HTMLElement>("#astralbeam-sidebar")
const toggle = document.querySelector<HTMLButtonElement>("#toggle")
if (!target || !toggle) throw new Error("Example markup is missing the sidebar or toggle button")

// Vanilla equivalent of a component registry: the widget announces render requests, and the host
// draws each one as a light-DOM child of the mount target with the requested slot attribute.
function renderCustomComponent(request: CustomComponentRenderRequest): void {
  if (target?.querySelector(`[slot="${request.slotName}"]`)) return
  const container = document.createElement("div")
  container.setAttribute("slot", request.slotName)
  if (request.componentIndex === 0) {
    const status = document.createElement("p")
    status.textContent = "Deployment #42 is live"
    container.append(status)
  } else {
    let count = 0
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = "Host counter: 0"
    button.addEventListener("click", () => {
      count += 1
      button.textContent = `Host counter: ${count}`
    })
    container.append(button)
  }
  target?.append(container)
}

const options: MountAstralBeamChatOptions = {
  customComponents: [
    { description: "Shows the host page's deployment status" },
    { description: "An interactive counter owned by the host page" },
  ],
  onRenderCustomComponent: renderCustomComponent,
}

let handle: AstralBeamChatHandle | undefined = mountAstralBeamChat(target, options)
toggle.addEventListener("click", () => {
  if (handle) {
    handle.unmount()
    handle = undefined
    toggle.textContent = "Mount widget"
  } else {
    handle = mountAstralBeamChat(target, options)
    toggle.textContent = "Unmount widget"
  }
})
