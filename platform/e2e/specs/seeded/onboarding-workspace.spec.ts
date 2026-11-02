import { SEED_ORGANIZATIONS } from "@scripts/seed/fixtures.ts"
import { expect, test } from "@e2e/fixtures.ts"

test("onboarding docks Astro once and keeps its pane and draft across setup pages", async ({
  page,
  astro,
  shell,
}) => {
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}?setup=true`)
  await expect(astro.panel).toBeVisible()
  await astro.close.click()
  await page.reload()
  await expect(page.getByRole("button", { name: "Ask Astro", exact: true })).toBeEnabled()
  await expect(astro.panel).not.toBeVisible()
  await page.getByRole("link", { name: "Set up with Astro", exact: true }).click()
  await expect(astro.panel).toBeVisible()
  const composer = astro.panel.getByRole("textbox", { name: "Message", exact: true })
  await expect(composer).toBeEnabled()
  const originalComposer = await composer.elementHandle()
  const intro = await astro.panel.boundingBox()
  await composer.fill("Help me integrate my application")
  // Expire organization data so navigation exercises the layout's loading fallback.
  await page.clock.setFixedTime(Date.now() + 31_000)
  await page.route("**/_serverFn/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1800))
    await route.continue()
  })
  await shell.openSection("Models", "Models")
  const before = await astro.panel.boundingBox()
  expect(before!.width).toBeLessThan(intro!.width)
  await shell.openSection("Agents", "Agents")
  await expect(composer).toHaveValue("Help me integrate my application")
  expect(await originalComposer.evaluate((element) => element.isConnected)).toBe(true)
  expect(await astro.panel.boundingBox()).toEqual(before)
})
