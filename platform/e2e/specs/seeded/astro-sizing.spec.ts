import { SEED_DOGFOOD, SEED_ORGANIZATIONS } from "@scripts/seed/fixtures.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { captureMilestone } from "@e2e/capture.ts"

test("Astro scopes resized width by organization across reloads and mobile", async ({
  page,
  astro,
  shell,
}) => {
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}`)
  await astro.open()
  await expect(astro.panel).toHaveCSS("width", "448px")
  await astro.resize.press("Shift+ArrowLeft")
  await expect(astro.panel).toHaveCSS("width", "498px")
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `astralbeam:chat-size:v1:component:chat-${SEED_ORGANIZATIONS[0].id}`,
    ),
  ).toBe(JSON.stringify({ width: 498 }))
  await captureMilestone(page, "astro-resized")

  await astro.resize.press("Escape")
  await expect(astro.panel).toBeHidden()
  await astro.open()
  await expect(astro.panel).toHaveCSS("width", "498px")

  await shell.switchOrganization(SEED_ORGANIZATIONS[0].name, SEED_DOGFOOD.name)
  await astro.open()
  await expect(astro.panel).toHaveCSS("width", "448px")
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `astralbeam:chat-size:v1:component:chat-${SEED_DOGFOOD.organizationId}`,
    ),
  ).toBeNull()
  await shell.switchOrganization(SEED_DOGFOOD.name, SEED_ORGANIZATIONS[0].name)
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

test("Astro keeps a mouse resize active when a page scrollbar changes available width", async ({
  page,
  astro,
  shell,
}) => {
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}`)
  await page.addStyleTag({
    content: "html { overflow-y: hidden; } html::-webkit-scrollbar { width: 15px; }",
  })
  await astro.open()
  const edge = (await astro.resize.boundingBox())!
  const x = edge.x + edge.width / 2
  const y = edge.y + edge.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 200, y, { steps: 8 })
  await expect(astro.panel).toHaveCSS("width", "648px")
  await page.evaluate(() => {
    document.documentElement.style.overflowY = "scroll"
    document.documentElement.style.scrollbarGutter = "stable"
  })
  const available = await page.evaluate(
    () => document.documentElement.getBoundingClientRect().width,
  )
  expect(available).toBe(1425)
  await expect(astro.panel).toHaveCSS("width", "648px")
  await page.mouse.move(0, y, { steps: 8 })
  await expect(astro.panel).toHaveCSS("width", `${available}px`)
  await expect(shell.navigation).toBeHidden()
  const key = `astralbeam:chat-size:v1:component:chat-${SEED_ORGANIZATIONS[0].id}`
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)).toBeNull()
  await page.mouse.up()
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)).toBe(
    JSON.stringify({ width: available }),
  )
  await captureMilestone(page, "astro-mouse-resize-with-scrollbar")
})
