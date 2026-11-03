import { SEED_ORGANIZATIONS } from "@scripts/seed/fixtures.ts"
import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"

test("E2B exposes its template and keeps credentials separate when switching providers", async ({
  page,
  sandboxes,
}) => {
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}/sandboxes`)
  await sandboxes.startCreate()
  await page.getByLabel("Name", { exact: true }).fill("E2B upgrade check")
  await sandboxes.selectProviderType("E2B")
  await expect(page.getByLabel("Template", { exact: true })).toHaveValue("base")
  await page.getByLabel("Template", { exact: true }).fill("custom-template")
  await page.getByLabel("API key", { exact: true }).fill("synthetic-e2b-key")
  await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute("type", "password")
  await captureMilestone(page, "e2b-template-and-masked-credential")
  await sandboxes.selectProviderType("Daytona")
  await expect(page.getByLabel("Snapshot", { exact: true })).toHaveValue("daytona-medium")
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("")
  await page.locator("#sandbox-provider-type").click()
  await expect(page.getByRole("option", { name: "Docker", exact: true })).toHaveCount(0)
  await page.getByRole("option", { name: "E2B", exact: true }).click()
  await expect(page.getByLabel("Template", { exact: true })).toHaveValue("base")
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("")
  await captureMilestone(page, "e2b-provider-switch-clears-credential")
})
