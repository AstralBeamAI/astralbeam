import { expect, type Locator, type Page } from "@playwright/test"

import { waitForHydration } from "../hydration.ts"

/** `/:orgSlug/sandboxes`. */
export function sandboxesPage(page: Page) {
  return {
    emptyState(): Locator {
      return page.getByText("No sandbox providers yet")
    },

    card(name: string): Locator {
      return page.locator('[data-slot="card"]').filter({ hasText: name })
    },

    async startCreate(): Promise<void> {
      await page.getByRole("link", { name: "Add provider" }).first().click()
      await expect(
        page.getByRole("heading", { level: 1, name: "Add sandbox provider" }),
      ).toBeVisible()
      await waitForHydration(page.locator("#sandbox-provider-name"))
    },

    async selectProviderType(label: string): Promise<void> {
      await page.locator("#sandbox-provider-type").click()
      await page.getByRole("option", { name: label }).click()
    },
  }
}

export type SandboxesPage = ReturnType<typeof sandboxesPage>
