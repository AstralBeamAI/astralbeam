import { expect, type Page } from "@playwright/test"

import { openDialog } from "../dialogs.ts"

/**
 * The create-organization dialog, reachable from onboarding, the sidebar switcher, and
 * `/organizations`. Tracks `src/components/auth/organization/create-organization-dialog.tsx`.
 */
export function createOrganizationDialog(page: Page) {
  const dialog = openDialog(page)

  return {
    dialog,

    /** The slug is generated with a random suffix, so a spec that asserts URLs sets its own. */
    async create(name: string, slug: string): Promise<void> {
      await dialog.locator("#create-organization-name").fill(name)
      await dialog.locator("#create-organization-slug").fill(slug)
      const submit = dialog.getByRole("button", { name: /create organization/i })
      await expect(submit).toBeEnabled({ timeout: 20_000 })
      await submit.click()
      await expect(dialog).toBeHidden()
    },
  }
}

export type CreateOrganizationDialog = ReturnType<typeof createOrganizationDialog>
