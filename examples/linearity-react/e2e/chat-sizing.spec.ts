import { expect, test } from "@playwright/test"

test("a hidden Astro preserves resized width, fills available space and handles zoomed dragging", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 950, height: 900 })
  await page.goto("/")
  const panel = page.getByRole("complementary", { name: "Astro assistant" })
  const toggle = page.getByRole("button", { name: "Astro", exact: true })
  const resize = panel.getByRole("separator", { name: "Resize chat", exact: true })
  const navigation = page.getByRole("navigation", { name: "Workspace navigation" })
  await expect(panel).toBeHidden()
  await toggle.click()
  await expect(panel).toHaveCSS("width", "350px")
  await resize.press("Shift+ArrowLeft")
  await expect(panel).toHaveCSS("width", "400px")
  await panel.getByRole("button", { name: "Close chat", exact: true }).click()
  await expect(panel).toBeHidden()
  await toggle.click()
  await expect(panel).toHaveCSS("width", "400px")
  await page.reload()
  await expect(panel).toBeHidden()
  await toggle.click()
  await expect(panel).toHaveCSS("width", "400px")

  await resize.press("End")
  await expect(page.getByRole("main")).toBeHidden()
  await expect(navigation).toBeVisible()
  await expect(panel).toHaveCSS("width", "886px")
  await page.screenshot({ path: testInfo.outputPath("linearity-full-width.png") })
  await resize.press("Home")
  await expect(panel).toHaveCSS("width", "320px")
  await expect(page.getByRole("main")).toBeVisible()

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1.4"
  })
  await expect(panel).toHaveCSS("width", "320px")
  const handle = await resize.boundingBox()
  const x = handle!.x + handle!.width / 2
  const y = handle!.y + handle!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 70, y)
  await page.mouse.up()
  await expect(panel).toHaveCSS("width", "370px")
  await expect
    .poll(async () => {
      const box = (await panel.boundingBox())!
      return box.x + box.width
    })
    .toBeLessThanOrEqual(1441)
  await expect(navigation).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("linearity-resized-140-percent.png") })
})
