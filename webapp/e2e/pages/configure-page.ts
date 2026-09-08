import { expect, type Locator, type Page } from "@playwright/test"

import { openAlertDialog } from "../dialogs.ts"
import { waitForHydration } from "../hydration.ts"

/**
 * The operator surface at `/configure`. Selectors track `src/routes/configure`, whose fields all
 * carry a `config-<key>` id and a Database or Environment badge.
 */
export function configurePage(page: Page) {
  const saveButton = page.getByRole("button", { name: "Save", exact: true }).first()

  return {
    async open(): Promise<void> {
      await page.goto("/configure")
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Configure")
    },

    async signIn(operatorKey: string): Promise<void> {
      const submit = page.getByRole("button", { name: "Sign in" })
      // Submitting before React attaches would post the key as a query string instead.
      await waitForHydration(submit)
      await page.getByLabel("Encryption key").fill(operatorKey)
      await submit.click()
      await expect(saveButton).toBeVisible()
    },

    field(key: string): Locator {
      return page.locator(`#config-${key}`)
    },

    /** The `Field` wrapper, which also holds the value's badges and its own action buttons. */
    fieldGroup(key: string): Locator {
      return page.locator('[data-slot="field"]').filter({ has: this.field(key) })
    },

    /** A value supplied by the server's environment is read-only here, so a spec must not set it. */
    isEnvironmentProvided(key: string): Promise<boolean> {
      return this.fieldGroup(key).getByText("Environment", { exact: true }).isVisible()
    },

    async setValue(key: string, value: string): Promise<void> {
      await this.field(key).fill(value)
    },

    /** Generates and stores a new secret. The confirmation button repeats the trigger's label. */
    async generateSecret(key: string): Promise<void> {
      const trigger = this.fieldGroup(key).getByRole("button", { name: /^(Generate|Rotate)$/ })
      const label = await trigger.innerText()
      await trigger.click()
      await openAlertDialog(page).getByRole("button", { name: label.trim() }).click()
      await expect(trigger).toHaveText("Rotate")
    },

    /** Checks the email provider settings currently in the form without sending anything. */
    async testEmailConnection(): Promise<void> {
      await page.getByRole("button", { name: "Test connection" }).click()
      await expect(page.getByText("Email provider connection succeeded")).toBeVisible({
        timeout: 30_000,
      })
    },

    setupStatus(): Locator {
      return page.getByText(/^Configuration (is complete|required)$/)
    },

    async save(): Promise<void> {
      await expect(saveButton).toBeEnabled()
      await saveButton.click()
      await expect(saveButton).toBeDisabled()
    },

    /** Ends the operator session and loads the application from the server. */
    async goToApp(): Promise<void> {
      // The actions row is rendered above and below the fields, so both copies match.
      await page.getByRole("button", { name: "Go to app" }).first().click()
      await page.waitForURL((url) => !url.pathname.startsWith("/configure"))
    },
  }
}

export type ConfigurePage = ReturnType<typeof configurePage>
