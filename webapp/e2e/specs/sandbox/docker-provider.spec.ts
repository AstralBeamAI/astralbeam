import { expect, test } from "../../fixtures.ts"
import { makeRunIdentity } from "../../identity.ts"
import { dockerDaemonAvailable } from "../../worktree.ts"

/**
 * Opt in with `E2E_SANDBOX=docker`. Saving a provider runs the product's own connection test,
 * which creates, uses, and destroys a real container and may pull its image first.
 */

test("saving a Docker provider passes its real connection test", async ({ page, baseline, sandboxes, shell }) => {
  expect(
    dockerDaemonAvailable(),
    "E2E_SANDBOX=docker is set, but no Docker daemon answered on the pinned endpoint",
  ).toBe(true)

  const providerName = `Local Docker ${makeRunIdentity().runId}`
  await page.goto(`/${baseline.organizationSlug}/sandboxes`)
  await sandboxes.createDockerProvider(providerName, "node:22")

  await shell.openSection("Sandboxes", "Sandboxes")
  await expect(sandboxes.card(providerName)).toBeVisible()
})
