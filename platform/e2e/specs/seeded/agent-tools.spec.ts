import { SEED_ORGANIZATIONS } from "../../../scripts/seed/fixtures.ts"
import { captureMilestone } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"

test("new agent tools default to available capabilities and preserve opt-outs", async ({
  page,
  agents,
}) => {
  const organization = SEED_ORGANIZATIONS[0]
  const name = `Tool defaults ${Date.now()}`
  await page.goto(`/${organization.slug}/agents`)
  await agents.startCreate()
  const web = page.getByRole("switch", { name: "Web access", exact: true })
  const sandbox = page.getByRole("switch", { name: "Sandbox", exact: true })
  await expect(web).toBeChecked()
  await expect(sandbox).toBeChecked()
  const model = page.getByRole("checkbox", { name: /./ })
  await model.uncheck()
  await expect(web).not.toBeChecked()
  await model.check()
  await expect(web).toBeChecked()
  await expect(page.getByRole("combobox", { name: "Connection", exact: true })).toHaveText(/docker/)
  await agents.fillForm({ name, systemPrompt: "Help with questions and cite public sources." })
  await agents.submitCreate()
  await expect(web).toBeChecked()
  await expect(sandbox).toBeChecked()
  await captureMilestone(page, "agent-tools-enabled")
  await web.uncheck()
  await sandbox.uncheck()
  await expect(page.getByRole("combobox", { name: "Connection", exact: true })).toBeHidden()
  await agents.saveChanges()
  await page.reload()
  await expect(web).not.toBeChecked()
  await expect(sandbox).not.toBeChecked()
  await web.check()
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Discard", exact: true }).click()
  await expect(web).not.toBeChecked()
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("heading", { level: 1, name }).scrollIntoViewIfNeeded()
  await captureMilestone(page, "agent-tools-mobile")
  await agents.setAsDefault()
  await page.goto(`/${organization.slug}/agents`)
  await agents.openAgent(organization.agents[1].name)
  await agents.setAsDefault()
  await page.goto(`/${organization.slug}/agents`)
  await agents.openAgent(name)
  await agents.deleteAgent(name)
})
