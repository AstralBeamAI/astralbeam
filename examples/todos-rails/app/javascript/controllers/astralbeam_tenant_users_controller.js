import { Controller } from "@hotwired/stimulus"
import { mountAstralBeamTenantUserList } from "@astralbeam/sdk/client"
import { appearance, tokenRequest } from "astralbeam_config"

// Mounts the read-only directory of the current tenant's users. It shares the chat token endpoint.
export default class extends Controller {
  static targets = ["list", "error", "errorMessage"]
  static values = { apiUrl: String, colorScheme: String, customTheme: Boolean, showAdmin: Boolean }

  connect() {
    this.list = mountAstralBeamTenantUserList(this.listTarget, {
      apiUrl: this.apiUrlValue,
      fetchAstralBeamToken: tokenRequest(),
      showAdmin: this.showAdminValue,
      onError: (error) => {
        this.errorMessageTarget.textContent = `Directory error: ${error.message}`
        this.errorTarget.hidden = false
      },
      ...this.appearance()
    })
  }

  disconnect() {
    this.list.unmount()
  }

  dismissError() {
    this.errorTarget.hidden = true
  }

  colorSchemeValueChanged() {
    this.list?.update(this.appearance())
  }

  customThemeValueChanged() {
    this.list?.update(this.appearance())
  }

  showAdminValueChanged() {
    this.list?.update({ showAdmin: this.showAdminValue })
  }

  appearance() {
    return appearance({ colorScheme: this.colorSchemeValue, customTheme: this.customThemeValue })
  }
}
