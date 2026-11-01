import { expect, type Page } from "@playwright/test"
import { waitForHydration } from "../hydration.ts"

export function docsPage(page: Page) {
  const trigger = page.getByRole("button", { name: "Search documentation", exact: true })
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true })
  const input = dialog.getByRole("combobox", { name: "Search documentation", exact: true })
  const results = dialog.getByRole("option")
  return {
    dialog,
    input,
    results,
    trigger,
    async open(path = "/docs") {
      await page.goto(path)
      await waitForHydration(trigger)
    },
    async openSearch() {
      await waitForHydration(trigger)
      await trigger.click()
      await expect(input).toBeFocused()
    },
    async search(query: string) {
      await input.fill(query)
      await expect(results.first()).toBeVisible()
    },
  }
}
