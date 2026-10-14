import { SEED_ORGANIZATIONS } from "@scripts/seed/fixtures.ts"
import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"

test("new agent tools default on when available and saved opt-outs survive reload", async ({
  page,
  agents,
}) => {
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}/agents`)
  await agents.startCreate()
  const web = page.getByRole("switch", { name: "Web access", exact: true })
  const sandbox = page.getByRole("switch", { name: "Sandbox", exact: true })
  test.skip(!(await web.isEnabled()), "Seed a supported model to verify creation defaults")
  await expect(web).toBeChecked()
  await expect(sandbox).toBeChecked()
  await agents.fillForm({
    name: `Tools ${Date.now()}`,
    systemPrompt: "Answer briefly and cite web sources.",
  })
  await captureMilestone(page, "agent-tools-defaults")
  await web.uncheck()
  await sandbox.uncheck()
  await agents.submitCreate()
  await page.reload()
  await expect(web).not.toBeChecked()
  await expect(sandbox).not.toBeChecked()
  await expect(page.getByRole("combobox", { name: "Sandbox connection", exact: true })).toHaveCount(
    0,
  )
  await captureMilestone(page, "agent-tools-saved-opt-outs")
})
