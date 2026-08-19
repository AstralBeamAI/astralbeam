import { type AstralBeamChatHandle, mountAstralBeamChat } from "@astralbeam/sdk/client"

const target = document.querySelector<HTMLElement>("#astralbeam-sidebar")
const toggle = document.querySelector<HTMLButtonElement>("#toggle")
if (!target || !toggle) throw new Error("Example markup is missing the sidebar or toggle button")

let handle: AstralBeamChatHandle | undefined = mountAstralBeamChat(target)
toggle.addEventListener("click", () => {
  if (handle) {
    handle.unmount()
    handle = undefined
    toggle.textContent = "Mount widget"
  } else {
    handle = mountAstralBeamChat(target)
    toggle.textContent = "Unmount widget"
  }
})
