import { SEED_ORGANIZATIONS } from "@scripts/seed/fixtures.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { captureMilestone } from "@e2e/capture.ts"

test("Astro preserves resized width across reloads and mobile and can fill available width", async ({
  page,
  astro,
  shell,
}) => {
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}`)
  await astro.open()
  await expect(astro.panel).toHaveCSS("width", "448px")
  await astro.resize.press("Shift+ArrowLeft")
  await expect(astro.panel).toHaveCSS("width", "498px")
  await captureMilestone(page, "astro-resized")

  await astro.close.click()
  await expect(astro.panel).toBeHidden()
  await astro.open()
  await expect(astro.panel).toHaveCSS("width", "498px")
  await page.reload()
  await expect(astro.panel).toHaveCSS("width", "498px")

  await page.setViewportSize({ width: 950, height: 900 })
  await expect(astro.panel).toHaveCSS("width", "950px")
  await expect(astro.panel.locator('[data-slot="chat"]')).toHaveCSS("width", "950px")
  await expect(astro.resize).toBeHidden()
  await page.setViewportSize({ width: 900, height: 900 })
  await expect(astro.panel).toHaveCSS("width", "900px")
  await expect(astro.panel.locator('[data-slot="chat"]')).toHaveCSS("width", "900px")
  await expect(astro.resize).toBeHidden()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(astro.panel).toHaveCSS("width", "498px")
  await expect(astro.resize).toBeVisible()

  await astro.resize.press("End")
  await expect(astro.panel).toHaveCSS("width", "1440px")
  await expect(shell.navigation).toBeHidden()
  await captureMilestone(page, "astro-full-width")
  await astro.resize.press("Home")
  await expect(astro.panel).toHaveCSS("width", "320px")
  await expect(shell.navigation).toBeVisible()
})
