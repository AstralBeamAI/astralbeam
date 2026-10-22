import { expect, type Locator, type Page } from "@playwright/test"

/**
 * Base UI toasts also carry `role="dialog"`, so a spec that waits on a dialog by role matches
 * every toast still on screen. Locate all three overlay kinds by their shadcn slot instead.
 */
export function openDialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]')
}

export function openAlertDialog(page: Page): Locator {
  return page.locator('[data-slot="alert-dialog-content"]')
}

/** Verifies and dismisses the expected toast so a later action cannot reuse it. */
export async function expectToast(page: Page, title: string): Promise<void> {
  const toast = page.locator('[data-slot="toast"]').filter({
    has: page.getByText(title, { exact: true }),
  })
  await expect(toast).toBeVisible()
  await toast.locator('[data-slot="toast-close"]').click()
  await expect(toast).toHaveCount(0)
}
