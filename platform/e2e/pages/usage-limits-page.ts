import { expect, type Locator, type Page } from "@playwright/test"

import { waitForHydration } from "../hydration.ts"

export type UsageLimitInput = {
  name: string
  appliesByDefault?: boolean
  scope?: string
  duration?: string
  custom?: { count: string; unit: string }
  windowType?: string
  timeZone?: string
  metric?: string
  amount: string
}

/** `/:orgSlug/usage-limits` and the shared create and edit form. */
export function usageLimitsPage(page: Page) {
  async function choose(trigger: Locator, option: string) {
    await trigger.click()
    await page.getByRole("option", { name: option, exact: true }).click()
  }

  return {
    table: page.getByRole("table", { name: "Usage limits" }),

    row(name: string): Locator {
      return this.table.getByRole("row").filter({ hasText: name })
    },

    enabledSwitch(name: string): Locator {
      return this.row(name).getByRole("switch", { name: `Enable ${name}` })
    },

    async startCreate(): Promise<void> {
      await page.getByRole("link", { name: "Add limit" }).first().click()
      await expect(page.getByRole("heading", { level: 1, name: "Add usage limit" })).toBeVisible()
      await waitForHydration(page.locator("#usage-limit-name"))
    },

    async fillForm(input: UsageLimitInput): Promise<void> {
      const appliesByDefault = page.getByRole("checkbox", { name: "Apply to every tenant user" })
      if (input.appliesByDefault !== undefined)
        await appliesByDefault.setChecked(input.appliesByDefault)
      await page.locator("#usage-limit-name").fill(input.name)
      if (input.scope) await choose(page.locator("#usage-limit-scope"), input.scope)
      if (input.duration) await choose(page.locator("#usage-limit-duration"), input.duration)
      if (input.custom) {
        await page.getByLabel("Number of units").fill(input.custom.count)
        await choose(page.getByLabel("Unit", { exact: true }), input.custom.unit)
      }
      if (input.windowType) await choose(page.locator("#usage-limit-window-type"), input.windowType)
      if (input.timeZone) await page.locator("#usage-limit-time-zone").selectOption(input.timeZone)
      if (input.metric) await choose(page.locator("#usage-limit-metric"), input.metric)
      await page.locator("#usage-limit-amount").fill(input.amount)
    },

    async submitCreate(name: string): Promise<void> {
      await page.getByRole("button", { name: "Create limit" }).click()
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
    },

    async saveChanges(): Promise<void> {
      await page.getByRole("button", { name: "Save changes" }).click()
      await expect(page.getByText("Usage limit saved")).toBeVisible()
    },

    async remove(name: string): Promise<void> {
      await page.getByRole("button", { name: `Delete ${name}` }).click()
      await page.getByRole("button", { name: "Delete limit" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Usage Limits" })).toBeVisible()
    },
  }
}

export type UsageLimitsPage = ReturnType<typeof usageLimitsPage>
