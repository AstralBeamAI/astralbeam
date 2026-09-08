import { expect, type Locator, type Page } from "@playwright/test"

import { expectToast } from "../dialogs.ts"
import { waitForHydration } from "../hydration.ts"

/**
 * `/settings/account` and `/settings/security`, both rendered by the Better Auth UI `Settings`
 * component under `src/components/auth/settings`.
 */
export function userSettingsPage(page: Page) {
  return {
    async openAccount(): Promise<void> {
      await page.goto("/settings/account")
      await expect(page.getByRole("heading", { level: 1, name: "Account settings" })).toBeVisible()
    },

    async openSecurity(): Promise<void> {
      await page.goto("/settings/security")
      await expect(page.getByRole("heading", { level: 1, name: "Security settings" })).toBeVisible()
    },

    /** The one editable profile field; the avatar upload is out of scope for a headless run. */
    async setDisplayName(name: string): Promise<void> {
      const save = page.getByRole("button", { name: /save changes/i }).first()
      await waitForHydration(save)
      await page.locator("#name").fill(name)
      await save.click()
      // The field already held this value before submit, so only the toast proves the write.
      await expectToast(page, "Profile updated successfully")
    },

    changePasswordCard(): Locator {
      return page.getByText(/change password/i).first()
    },

    activeSessionsCard(): Locator {
      return page.getByText(/active sessions/i).first()
    },
  }
}

export type UserSettingsPage = ReturnType<typeof userSettingsPage>
