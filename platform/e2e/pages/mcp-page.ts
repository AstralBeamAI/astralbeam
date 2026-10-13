import { expect, type Page } from "@playwright/test"
import { waitForHydration } from "../hydration.ts"
import { expectToast, openAlertDialog, openDialog } from "../dialogs.ts"

export function mcpPage(page: Page) {
  const account = (name: string) =>
    page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) })
  return {
    async open(slug: string) {
      await page.goto(`/${slug}/mcp`)
      await waitForHydration(page.getByRole("button", { name: "Add server", exact: true }))
      await expect(page.locator("#mcp-name")).toHaveCount(0)
    },
    async inspectGoogleSetup() {
      await page.getByRole("button", { name: "Add server", exact: true }).click()
      await expect(page.getByLabel("Static header names, comma separated")).toHaveCount(0)
      await page.getByLabel("Authentication", { exact: true }).selectOption("oauth")
      await page.getByLabel("OAuth provider").selectOption("google")
      await expect(page.getByLabel("OAuth registration")).toHaveValue("pre_registered")
      await expect(
        page.getByText("Google requires a registered OAuth application.", { exact: false }),
      ).toBeVisible()
      await openDialog(page).getByRole("button", { name: "Cancel", exact: true }).click()
    },
    async createStaticServer(name: string) {
      await page.getByRole("button", { name: "Add server", exact: true }).click()
      await page.getByLabel("Name", { exact: true }).fill(name)
      await page.getByLabel("Public HTTPS endpoint").fill("http://127.0.0.1/mcp")
      await page.getByRole("button", { name: "Save server", exact: true }).click()
      await expect(page.getByRole("alert")).toBeVisible()
      await page.getByLabel("Public HTTPS endpoint").fill("https://mcp.example.test/mcp")
      await page.getByLabel("Authentication", { exact: true }).selectOption("static_headers")
      await page.getByLabel("Static header names, comma separated").fill("Authorization, X-Api-Key")
      await page.getByRole("button", { name: "Save server", exact: true }).click()
      await expectToast(page, "Server saved")
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
    },
    async createAccount(name: string, server: string) {
      await page.getByRole("button", { name: "Add shared account", exact: true }).click()
      await page.getByLabel("Account name", { exact: true }).fill(name)
      await page.getByLabel("Server", { exact: true }).selectOption({ label: server })
      await page.getByLabel("Authorization value").fill("Bearer browser-fixture-secret")
      await page.getByLabel("X-Api-Key value").fill("browser-fixture-key")
      await page.getByRole("button", { name: "Save account", exact: true }).click()
      await expectToast(page, "Account saved")
      await expect(account(name)).toContainText("Connected")
    },
    async renameAccount(name: string, replacement: string) {
      await account(name).getByRole("button", { name: "Edit account", exact: true }).click()
      await expect(page.getByLabel("Authorization value")).toHaveValue("")
      await expect(page.getByLabel("X-Api-Key value")).toHaveValue("")
      await page.getByLabel("Account name", { exact: true }).fill(replacement)
      await page.getByRole("button", { name: "Save account", exact: true }).click()
      await expect(account(replacement)).toBeVisible()
      await page.reload()
      await waitForHydration(page.getByRole("button", { name: "Add server", exact: true }))
      await expect(page.getByText("browser-fixture-secret", { exact: false })).toHaveCount(0)
      await expect(account(replacement)).toContainText("Connected")
    },
    async rejectPartialCredentialReplacement(name: string) {
      await account(name).getByRole("button", { name: "Edit account", exact: true }).click()
      await page.getByLabel("Authorization value").fill("Bearer replacement")
      await openDialog(page).getByRole("button", { name: "Save account", exact: true }).click()
      await expect(openDialog(page).getByRole("alert")).toContainText("Enter every header value")
      await openDialog(page).getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(account(name)).toContainText("Connected")
    },
    async enableByo() {
      await page.getByText("Custom server permissions", { exact: true }).click()
      await page.getByLabel("Allow Tenants to add shared servers").check()
      await page.getByLabel("Allow Tenant users to add personal servers").check()
      await page.getByRole("button", { name: "Save permissions" }).click()
      await expectToast(page, "Permissions saved")
      await expect(page.getByRole("alert")).toHaveCount(0)
    },
    async removeAccount(name: string) {
      await account(name).getByRole("button", { name: "Disconnect locally" }).click()
      await expect(account(name)).toContainText("Not connected")
      await account(name).getByRole("button", { name: "Delete account", exact: true }).click()
      await openAlertDialog(page).getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(account(name)).toBeVisible()
      await account(name).getByRole("button", { name: "Delete account", exact: true }).click()
      await openAlertDialog(page)
        .getByRole("button", { name: "Delete account", exact: true })
        .click()
      await expectToast(page, "Account deleted")
      await expect(account(name)).toHaveCount(0)
    },
    async removeServer(name: string) {
      await account(name).getByRole("button", { name: "Delete server", exact: true }).click()
      await expect(openAlertDialog(page)).toContainText("including Tenant and personal accounts")
      await openAlertDialog(page)
        .getByRole("button", { name: "Delete server", exact: true })
        .click()
      await expectToast(page, "Server deleted")
      await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0)
    },
  }
}
export type McpPage = ReturnType<typeof mcpPage>
