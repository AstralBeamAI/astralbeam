import { expect, type Locator, type Page } from "@playwright/test"

import { openAlertDialog, openDialog } from "../dialogs.ts"
import { waitForHydration } from "../hydration.ts"

/**
 * `/:orgSlug/api-keys` and its Better Auth UI dialogs. The full credential is shown exactly once,
 * in the dialog that follows creation, so a spec has to read it there.
 */
export function apiKeysPage(page: Page) {
  return {
    newKeyField: page.locator("#new-api-key"),
    newKeyCopyButton: openDialog(page).getByRole("button", { name: /cop(?:y|ied).*clipboard/i }),
    manualCopyHelp: page.getByRole("alert").filter({ hasText: "Couldn't copy automatically" }),

    row(name: string): Locator {
      return page.locator('[data-slot="item"]').filter({ hasText: name })
    },

    deleteButton(name: string): Locator {
      return this.row(name).getByRole("button", { name: /delete api key/i })
    },

    async openCreateDialog(): Promise<void> {
      const createButton = page.getByRole("button", { name: /create api key/i }).first()
      await waitForHydration(createButton)
      await createButton.click()
      await expect(page.locator("#api-key-name")).toBeVisible()
    },

    /** Creates a key and returns the one-time `key_<organization>_<id>_abo_<secret>` credential. */
    async createKey(name: string): Promise<string> {
      await this.createKeyAndKeepDialogOpen(name)
      const secret = await this.newKeyField.inputValue()
      await this.dismissCreatedKey()
      await expect(this.row(name)).toBeVisible()
      return secret
    },

    async createKeyAndKeepDialogOpen(name: string): Promise<void> {
      await this.openCreateDialog()
      await page.locator("#api-key-name").fill(name)
      await openDialog(page)
        .getByRole("button", { name: /create api key/i })
        .click()
      await expect(this.newKeyField).toBeVisible()
    },

    async dismissCreatedKey(): Promise<void> {
      await page.getByRole("button", { name: /saved my key/i }).click()
      await expect(this.newKeyField).toBeHidden()
    },

    async setClipboardResult(result: "success" | "rejected" | "unavailable"): Promise<void> {
      await page.evaluate((outcome) => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value:
            outcome === "unavailable"
              ? undefined
              : {
                  writeText: () =>
                    outcome === "success"
                      ? Promise.resolve()
                      : Promise.reject(new Error("Clipboard permission denied")),
                },
        })
      }, result)
    },

    async deleteKey(name: string): Promise<void> {
      await this.deleteButton(name).click()
      await openAlertDialog(page)
        .getByRole("button", { name: /delete api key/i })
        .click()
      await expect(this.row(name)).toBeHidden()
    },
  }
}

export type ApiKeysPage = ReturnType<typeof apiKeysPage>
