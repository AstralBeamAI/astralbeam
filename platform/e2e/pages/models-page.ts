import { expect, type Page } from "@playwright/test"

import { expectToast, openAlertDialog } from "../dialogs.ts"
import { waitForHydration } from "../hydration.ts"

export function modelsPage(page: Page) {
  return {
    async create(input: {
      name: string
      modelId: string
      apiKey: string
      baseUrl?: string
      provider?: "OpenAI" | "Anthropic" | "OpenRouter"
    }): Promise<void> {
      await page.getByRole("link", { name: "Add provider", exact: true }).first().click()
      await waitForHydration(page.locator("#model-provider-name"))
      await page.getByLabel("Name", { exact: true }).fill(input.name)
      if (input.provider) {
        await page.getByRole("combobox", { name: "Provider", exact: true }).click()
        await page.getByRole("option", { name: input.provider, exact: true }).click()
      }
      await page.getByLabel("API key", { exact: true }).fill(input.apiKey)
      if (input.baseUrl) await page.getByLabel("API URL", { exact: true }).fill(input.baseUrl)
      await page.getByRole("checkbox", { name: input.modelId, exact: true }).check()
      const override = page.getByRole("switch", {
        name: `Override catalog defaults for ${input.modelId}`,
        exact: true,
      })
      await expect(override).toBeVisible()
      if (
        await page
          .getByText(
            "No catalog defaults are available. Turn on to configure this model manually.",
            { exact: true },
          )
          .isVisible()
      ) {
        await override.check()
        await page.getByLabel(`Input price for ${input.modelId}`, { exact: true }).fill("2")
        await page.getByLabel(`Output price for ${input.modelId}`, { exact: true }).fill("8")
        await page.getByLabel(`Input maximum for ${input.modelId}`, { exact: true }).fill("128000")
      }
      // A successful save must not flash the missing-key error before navigating.
      await page.evaluate(() => {
        new MutationObserver(() => {
          if (document.body.innerText.includes("Enter an API key"))
            document.body.dataset.keyErrorShown = "true"
        }).observe(document.body, { childList: true, subtree: true })
      })
      await page.getByRole("button", { name: "Save provider", exact: true }).click()
      await expect(page.getByRole("heading", { level: 1, name: input.name })).toBeVisible()
      await expect(page.locator("body")).not.toHaveAttribute("data-key-error-shown")
    },

    async open(name: string): Promise<void> {
      await page.getByRole("link", { name, exact: true }).click()
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
      await waitForHydration(page.locator("#model-provider-name"))
    },

    async save(): Promise<void> {
      await page.getByRole("button", { name: "Save provider", exact: true }).click()
      await expectToast(page, "Provider saved")
    },

    async requestDelete(): Promise<void> {
      await page.getByRole("button", { name: "Delete provider", exact: true }).click()
      await openAlertDialog(page)
        .getByRole("button", { name: "Delete provider", exact: true })
        .click()
    },
  }
}

export type ModelsPage = ReturnType<typeof modelsPage>
