import { expect, test } from "@e2e/fixtures.ts"
import { waitForHydration } from "@e2e/hydration.ts"
import { captureMilestone } from "@e2e/capture.ts"

test("dashboard guidance and agent drafts work across screen sizes", async ({
  page,
  baseline,
  shell,
  agents,
}) => {
  await page.goto(`/${baseline.organizationSlug}`)
  await expect(page.getByRole("heading", { name: "Connect your app", exact: true })).toBeVisible()
  const setup = page.getByRole("button", { name: "Add a provider and enable models", exact: false })
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
