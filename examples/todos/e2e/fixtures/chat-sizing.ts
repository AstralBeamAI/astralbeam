import { mountAstralBeamChat } from "@astralbeam/sdk/client"
import { ASTRALBEAM_API_URL, CHAT_AGENT_ID } from "../../src/lib/config.ts"

const boundary = document.querySelector<HTMLElement>("main")!
const resizing = document.querySelector<HTMLInputElement>("#resizing")!
const fillWidth = document.querySelector<HTMLInputElement>("#fill-width")!
const host = document.querySelector<HTMLElement>("aside")!
const chat = mountAstralBeamChat(host, {
  apiUrl: ASTRALBEAM_API_URL,
  agentId: host.dataset.agentId || CHAT_AGENT_ID,
  initialWidth: Number(host.dataset.initialWidth) || undefined,
  resizeContainer: () => boundary,
})

resizing.addEventListener("change", () => chat.update({ resizable: resizing.checked }))
fillWidth.addEventListener("change", () =>
  chat.update({ initialWidth: fillWidth.checked ? "100%" : 480 }),
)
document.querySelector("#default-width")!.addEventListener("click", () => {
  chat.update({ initialWidth: 520 })
})
document.querySelector("#show")!.addEventListener("click", () => {
  host.parentElement!.style.display = "contents"
})
