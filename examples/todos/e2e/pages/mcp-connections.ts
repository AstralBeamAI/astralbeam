import { expect, type Page } from "@playwright/test"

export function mcpConnections(page: Page) {
  const root = page.locator("aside.chat-sidebar")
  return {
    async open() {
      await root.getByRole("button", { name: "Connections", exact: true }).click()
      await expect(root.getByRole("heading", { name: "Connections", exact: true })).toBeVisible()
      await expect(root.getByRole("status", { name: "Loading connections…" })).toHaveCount(0)
    },
    async addAccount() {
      await root.getByRole("button", { name: "Add account", exact: true }).click()
    },
    accountForm: root
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Add account", exact: true }) }),
    account(name: string) {
      return root
        .locator('[data-slot="mcp-account"]')
        .filter({ has: page.getByRole("heading", { name, exact: true }) })
    },
    alert: root.getByRole("alert"),
    notice: root.locator('[data-slot="mcp-notice"]'),
    panel: root,
  }
}
