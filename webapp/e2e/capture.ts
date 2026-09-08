import { type Page, test } from "@playwright/test"

/**
 * Screenshots a moment worth showing on its own, into the test's output directory and the run's
 * report. Video and traces cover a failure; this is how a green run proves what it did.
 */
export async function captureMilestone(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await test.info().attach(name, { path, contentType: "image/png" })
}
