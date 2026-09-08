import { expect, type Locator, type Page } from "@playwright/test"

import { waitForHydration } from "../hydration.ts"

/**
 * `/:orgSlug/sandboxes`. Saving a provider runs a real connection test first, so
 * `createDockerProvider` needs a reachable Docker daemon.
 */
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
      await expect(page.getByRole("heading", { level: 1, name: "Add sandbox provider" }))
        .toBeVisible()
      await waitForHydration(page.locator("#sandbox-provider-name"))
    },

    async selectProviderType(label: string): Promise<void> {
      await page.locator("#sandbox-provider-type").click()
      await page.getByRole("option", { name: label }).click()
    },

    /** Docker is the only provider with no credential, so it is the only one a suite can install. */
    async createDockerProvider(name: string, image: string): Promise<void> {
      await this.startCreate()
      await page.locator("#sandbox-provider-name").fill(name)
      await this.selectProviderType("Docker")
      await page.locator("#docker-image").fill(image)
      await page.getByRole("button", { name: "Test and save" }).click()
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 120_000 })
    },
  }
}

export type SandboxesPage = ReturnType<typeof sandboxesPage>
