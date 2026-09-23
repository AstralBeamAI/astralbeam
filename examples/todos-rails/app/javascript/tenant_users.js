import { mountAstralBeamTenantUserList } from "@astralbeam/sdk/client"
import { bindAppearanceButtons, tokenRequest } from "astralbeam_config"

// The read-only directory of the current tenant's users shares the chat token endpoint.
const error = document.getElementById("directory-error")
const list = mountAstralBeamTenantUserList(document.getElementById("astralbeam-tenant-users"), {
  apiUrl: document.getElementById("app").dataset.apiUrl,
  fetchAstralBeamToken: tokenRequest(),
  onError: ({ message }) => {
    error.querySelector("p").textContent = `Directory error: ${message}`
    error.hidden = false
  }
})

bindAppearanceButtons((options) => list.update(options))
document.getElementById("show-admin").addEventListener("change", (event) => list.update({ showAdmin: event.target.checked }))
error.querySelector("button").addEventListener("click", () => (error.hidden = true))
