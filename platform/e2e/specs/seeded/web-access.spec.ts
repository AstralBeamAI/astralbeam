import process from "node:process"
import { SEED_DOGFOOD, SEED_ORGANIZATIONS } from "../../../scripts/seed/fixtures.ts"
import { captureMilestone } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"

test("Existing Web access settings stay disabled and the saved grant survives reload", async ({
  page,
  agents,
}) => {
  const organization = SEED_ORGANIZATIONS[0]
  await page.goto(`/${organization.slug}/agents`)
  await agents.openAgent(organization.agents[0].name)
  const grant = page.getByRole("switch", { name: "Web access", exact: true })
  await expect(grant).not.toBeChecked()
  await grant.check()
  await agents.saveChanges()
  await page.reload()
  await expect(grant).toBeChecked()
  await captureMilestone(page, "web-access-configuration")
  await grant.uncheck()
  await agents.saveChanges()
})

test("live cited answer survives reload and appears in the read-only directory", async ({
  page,
  agents,
  astro,
}) => {
  test.skip(process.env.ASTRALBEAM_LIVE_WEB !== "1", "Paid provider calls are opt-in")
  test.setTimeout(180_000)
  await page.goto(`/${SEED_DOGFOOD.slug}/agents`)
  await agents.openAgent("Dogfood Assistant")
  const grant = page.getByRole("switch", { name: "Web access", exact: true })
  await grant.check()
  await agents.saveChanges()
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}`)
  await astro.open()
  const composer = astro.panel.getByRole("textbox", { name: "Message" })
  await composer.fill(
    "Search the web for TanStack AI provider tools and read https://tanstack.com/ai/latest/docs/tools/provider-tools. Cite that page and explain provider tools in one short sentence.",
  )
  await composer.press("Enter")
  const citation = astro.panel.getByRole("link", { name: "1", exact: true }).first()
  await expect(citation).toHaveAttribute("href", /^https:\/\/tanstack\.com\//, { timeout: 90_000 })
  await expect(composer).toBeEnabled()
  await astro.panel.getByRole("button", { name: "Searched the web" }).first().click()
  await captureMilestone(page, "web-cited-answer")
  await page.reload()
  await expect(astro.panel).toBeVisible()
  await expect(citation).toBeVisible()
  await captureMilestone(page, "web-citations-reloaded")
  await page.goto(`/${SEED_DOGFOOD.slug}/threads`)
  await page.getByRole("combobox", { name: "Tenant", exact: true }).fill(SEED_ORGANIZATIONS[0].name)
  await page.getByRole("option", { name: new RegExp(SEED_ORGANIZATIONS[0].name) }).click()
  await page
    .getByRole("button", { name: /^Search the web for TanStack AI/ })
    .first()
    .click()
  await expect(page.getByText("Saved conversation · Read only")).toBeVisible()
  await expect(page.getByRole("link", { name: "1", exact: true }).first()).toBeVisible()
  await captureMilestone(page, "web-read-only-transcript")
  await page.goto(`/${SEED_DOGFOOD.slug}/agents`)
  await agents.openAgent("Dogfood Assistant")
  await grant.uncheck()
  await agents.saveChanges()
})
