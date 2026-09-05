import { type Page, test } from "@playwright/test"

/**
 * Attaches a named screenshot to the run's report, for the moments worth showing on their own:
 * the agent's cards in the conversation, the sandbox panel with files in it. Video and traces
 * cover a failure; this covers proving a green run did what it claims.
 *
 * Attachments land in `e2e/.output/report`; open it with `playwright show-report e2e/.output/report`.
 */
export async function captureMoment(page: Page, name: string): Promise<void> {
  await test.info().attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  })
}
