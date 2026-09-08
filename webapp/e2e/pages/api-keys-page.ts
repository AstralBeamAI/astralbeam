import { expect, type Locator, type Page } from "@playwright/test"

import { openAlertDialog, openDialog } from "../dialogs.ts"

/**
 * `/:orgSlug/api-keys` and its Better Auth UI dialogs. The full credential is shown exactly once,
 * in the dialog that follows creation, so a spec has to read it there.
 */
export function apiKeysPage(page: Page) {
  return {
    row(name: string): Locator {
      return page.locator('[data-slot="item"]').filter({ hasText: name })
    },

    async openCreateDialog(): Promise<void> {
      await page.getByRole("button", { name: /create api key/i }).first().click()
      await expect(page.locator("#api-key-name")).toBeVisible()
    },

    /** Creates a key and returns the one-time `key_<organization>_<id>_abo_<secret>` credential. */
    async createKey(name: string): Promise<string> {
      await this.openCreateDialog()
      await page.locator("#api-key-name").fill(name)
      await openDialog(page).getByRole("button", { name: /create api key/i }).click()
      const secretField = page.locator("#new-api-key")
      await expect(secretField).toBeVisible()
      const secret = await secretField.inputValue()
      await page.getByRole("button", { name: /saved my key/i }).click()
      await expect(this.row(name)).toBeVisible()
      return secret
    },

    async deleteKey(name: string): Promise<void> {
      await this.row(name).getByRole("button", { name: /delete api key/i }).click()
      await openAlertDialog(page).getByRole("button", { name: /delete api key/i }).click()
      await expect(this.row(name)).toBeHidden()
    },
  }
}

export type ApiKeysPage = ReturnType<typeof apiKeysPage>
