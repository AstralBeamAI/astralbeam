import { type Page } from "@playwright/test"
import { todosPage } from "./todos-page.ts"

export function threadDirectoryPage(page: Page) {
  const directory = page.getByRole("region", { name: "Conversations", exact: true })
  return {
    directory,
    transcript: directory.getByRole("region", { name: "Saved conversation", exact: true }),
    search: directory.getByRole("searchbox", { name: "Search conversations", exact: true }),
    refresh: directory.getByRole("button", { name: "Refresh directory", exact: true }),
    next: directory.getByRole("button", { name: "Next", exact: true }),
    previous: directory.getByRole("button", { name: "Previous", exact: true }),
    back: directory.getByRole("button", { name: "Back to conversations", exact: true }),
    messages: directory.getByRole("region", { name: "Messages", exact: true }),
    tenantPicker: directory.getByRole("combobox", { name: "Tenant", exact: true }),
    clearTenant: directory.getByRole("button", { name: "Clear selection", exact: true }),
    conversation: (name: string) => directory.getByRole("button", { name, exact: true }),
    selectTenant: async (name: string) => {
      await directory.getByRole("combobox", { name: "Tenant", exact: true }).fill(name)
      await directory.getByRole("option", { name: new RegExp(name) }).click()
    },
    openReact: async () => {
      await todosPage(page).open()
      await page
        .getByRole("navigation", { name: "Example pages" })
        .getByRole("link", { name: "Conversations", exact: true })
        .click()
    },
  }
}
