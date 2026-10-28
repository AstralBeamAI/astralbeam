import { expect, test } from "@e2e/fixtures.ts"
import { waitForHydration } from "@e2e/hydration.ts"
import { captureMilestone } from "@e2e/capture.ts"
import { makeRunIdentity } from "@e2e/identity.ts"
import { agentsPage } from "@e2e/pages/agents-page.ts"

test("dashboard guidance and agent drafts work across screen sizes", async ({
  page,
  baseline,
  shell,
  agents,
}) => {
  await page.goto(`/${baseline.organizationSlug}`)
  await expect(page.getByRole("heading", { name: "Connect your app", exact: true })).toBeVisible()
  const setup = page.getByRole("button", { name: "Connect a model provider", exact: false })
  await waitForHydration(setup)
  await expect(setup).toHaveAttribute("aria-expanded", "false")
  await setup.click()
  await expect(page.getByRole("link", { name: "Manage models", exact: true })).toBeVisible()
  await captureMilestone(page, "dashboard-desktop")
  await shell.openSection("Agents", "Agents")
  await agents.cards().first().getByRole("link").click()
  const name = page.getByRole("textbox", { name: "Name", exact: true })
  const original = await name.inputValue()
  await waitForHydration(name)
  await name.fill("Unsaved agent name")
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Discard changes", exact: true }).click()
  await expect(name).toHaveValue(original)
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.evaluate(() => window.scrollTo(0, 0))
    await captureMilestone(page, `agent-width-${width}`)
  }
})

test("agent save failures preserve drafts until retry or explicit conflict recovery", async ({
  page,
  context,
  baseline,
  agents,
}) => {
  const name = `Recovery agent ${makeRunIdentity().runId}`
  await page.goto(`/${baseline.organizationSlug}/agents`)
  await agents.startCreate()
  await waitForHydration(agents.nameField)
  await agents.fillForm({ name, systemPrompt: "Saved instructions" })
  await agents.submitCreate()
  await agents.fillForm({ name: `${name} draft`, systemPrompt: "Unsaved instructions" })
  await context.setOffline(true)
  try {
    await agents.saveButton.click()
    await expect(agents.saveFailure).toBeVisible()
    await agents.nameField.fill(`${name} retry`)
    await expect(agents.saveFailure).toBeVisible()
    await expect(agents.systemPromptField).toHaveValue("Unsaved instructions")
    await captureMilestone(page, "agent-save-failure")
  } finally {
    await context.setOffline(false)
  }
  await agents.saveChanges()
  await expect(
    page.getByRole("heading", { level: 1, name: `${name} retry`, exact: true }),
  ).toBeVisible()
  await expect(agents.saveFailure).toBeHidden()

  const stalePage = await context.newPage()
  const staleAgent = agentsPage(stalePage)
  await stalePage.goto(page.url())
  await waitForHydration(staleAgent.nameField)
  await agents.fillForm({ name: `${name} latest`, systemPrompt: "Latest saved instructions" })
  await agents.saveChanges()
  await expect(
    page.getByRole("heading", { level: 1, name: `${name} latest`, exact: true }),
  ).toBeVisible()
  await staleAgent.fillForm({ name: `${name} local`, systemPrompt: "Keep this local draft" })
  await staleAgent.saveButton.click()
  await expect(staleAgent.saveFailure).toBeVisible()
  await expect(staleAgent.systemPromptField).toHaveValue("Keep this local draft")
  await expect(staleAgent.saveButton).toBeDisabled()
  await captureMilestone(stalePage, "agent-save-conflict")
  await staleAgent.reloadButton.click()
  await expect(staleAgent.systemPromptField).toHaveValue("Latest saved instructions")
  await expect(staleAgent.saveFailure).toBeHidden()
  await expect(staleAgent.saveButton).toBeEnabled()
  await stalePage.close()
})
