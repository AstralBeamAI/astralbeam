import type { Locator, Page } from "@playwright/test"

/**
 * Base UI toasts also carry `role="dialog"`, so a spec that waits on a dialog by role matches
 * every toast still on screen. Locate the two overlay kinds by their shadcn slot instead.
 */
export function openDialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]')
}

export function openAlertDialog(page: Page): Locator {
  return page.locator('[data-slot="alert-dialog-content"]')
}
