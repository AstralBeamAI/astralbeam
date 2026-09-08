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

/**
 * Waits for a success toast. A mutation's own controls are disabled while it runs and enabled
 * again afterwards, so only the toast tells a caller the write actually landed.
 */
export async function expectToast(page: Page, title: string): Promise<void> {
  await expect(page.locator('[data-slot="toast-title"]').filter({ hasText: title }))
    .toBeVisible()
}
