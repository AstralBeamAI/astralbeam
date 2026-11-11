import { expect, type Locator, type Page } from "@playwright/test"

import { openDialog } from "../dialogs.ts"

/** Fills and submits the create-organization form, inline on onboarding or inside the dialog. */
export async function submitCreateOrganizationForm(
  form: Locator,
  name: string,
  slug: string,
): Promise<void> {
  await form.locator("#create-organization-name").fill(name)
  await form.locator("#create-organization-slug").fill(slug)
  const submit = form.getByRole("button", { name: /create organization/i })
  await expect(submit).toBeEnabled({ timeout: 20_000 })
  await submit.click()
}

/**
 * The create-organization dialog, reachable from onboarding, the sidebar switcher, and
 * `/organizations`. Tracks `src/components/auth/organization/create-organization-dialog.tsx`.
 */
export function createOrganizationDialog(page: Page) {
  const dialog = openDialog(page)

  return {
    dialog,

    /** The slug follows the name, so a spec that asserts URLs sets its own unique one. */
    async create(name: string, slug: string): Promise<void> {
      await submitCreateOrganizationForm(dialog, name, slug)
      await expect(dialog).toBeHidden()
    },
  }
}

export type CreateOrganizationDialog = ReturnType<typeof createOrganizationDialog>
