import { expect, type Page } from "@playwright/test"
import { waitForHydration } from "../hydration.ts"
import { expectToast, openAlertDialog, openDialog } from "../dialogs.ts"

export function mcpPage(page: Page) {
  return {
    async open(slug: string) {
      await page.goto(`/${slug}/mcp`)
      await waitForHydration(page.getByRole("button", { name: "Add server", exact: true }))
    },
    async inspectGoogleSetup() {
      await page.getByRole("button", { name: "Add server", exact: true }).click()
      await page.getByLabel("Authentication", { exact: true }).selectOption("oauth")
      await page.getByLabel("OAuth provider").selectOption("google")
      await expect(page.getByLabel("Use a pre-registered OAuth application")).toBeChecked()
      await expect(page.getByLabel("Client ID", { exact: true })).toBeVisible()
      await expect(page.getByLabel("Redirect URI")).toHaveValue(/\/api\/mcp\/oauth\/callback$/)
      await openDialog(page).getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(openDialog(page)).not.toBeVisible()
    },
    async createStaticServer(endpoint: string) {
      await page.getByRole("button", { name: "Add server", exact: true }).click()
      const dialog = openDialog(page)
      await dialog.getByLabel("Public HTTPS endpoint").fill("http://127.0.0.1/mcp")
      await dialog.getByRole("button", { name: "Add server", exact: true }).click()
      await expect(dialog.getByRole("alert")).toBeVisible()
      await dialog.getByLabel("Public HTTPS endpoint").fill(endpoint)
      await dialog.getByLabel("Authentication", { exact: true }).selectOption("static_headers")
      await dialog.getByLabel("Header names, comma separated").fill("Authorization, X-Api-Key")
      await dialog.getByRole("button", { name: "Add server", exact: true }).click()
      await expectToast(page, "Server added")
      await expect(
        page.getByRole("heading", { name: new URL(endpoint).hostname, exact: true }),
      ).toBeVisible()
    },
    async removeServer(endpoint: string) {
      const server = page.locator("article").filter({
        has: page.getByRole("heading", { name: new URL(endpoint).hostname, exact: true }),
      })
      await server.getByRole("button", { name: "Remove server", exact: true }).click()
      await openAlertDialog(page).getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(openAlertDialog(page)).not.toBeVisible()
      await expect(server).toBeVisible()
      await server.getByRole("button", { name: "Remove server", exact: true }).click()
      await openAlertDialog(page)
        .getByRole("button", { name: "Remove server", exact: true })
        .click()
      await expectToast(page, "Server removed")
      await expect(server).toHaveCount(0)
    },
  }
}
export type McpPage = ReturnType<typeof mcpPage>
