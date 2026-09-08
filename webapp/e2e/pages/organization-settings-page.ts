import type { Page } from "@playwright/test"

import { expectToast } from "../dialogs.ts"

/** `/:orgSlug/settings`. Changing the slug moves every organization URL, including this one. */
export function organizationSettingsPage(page: Page) {
  return {
    async rename(name: string): Promise<void> {
      await page.locator("#organization-name").fill(name)
      await page.getByRole("button", { name: "Save changes" }).click()
      await expectToast(page, "Organization saved")
    },

    async changeSlug(slug: string): Promise<void> {
      await page.locator("#organization-slug").fill(slug)
      await page.getByRole("button", { name: "Save changes" }).click()
      await page.waitForURL(`**/${slug}/settings`)
    },
  }
}

export type OrganizationSettingsPage = ReturnType<typeof organizationSettingsPage>
