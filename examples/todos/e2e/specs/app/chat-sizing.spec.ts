import { expect, test } from "../../fixtures.ts"
import { captureMoment } from "../../capture.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { chatSizing } from "../../pages/chat-sizing.ts"
import { todosPage } from "../../pages/todos-page.ts"
import {
  SEED_ORGANIZATIONS,
  SEED_TODOS_TARGET,
} from "../../../../../platform/scripts/seed/fixtures.ts"

const organization = SEED_ORGANIZATIONS[0]
const firstAgent = `agent_${organization.id}_${organization.agents[0].id}`
const secondAgent = `agent_${organization.id}_${organization.agents[1].id}`
const WIDTH_STORAGE_KEY = `astralbeam:chat-size:v1:organization:${organization.id}:component:chat-sizing-test:agent:${SEED_TODOS_TARGET.agentId}`

test("horizontal sizing keeps full height and restores in reloads and new tabs", async ({
  page,
  context,
  chat,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await chat.waitForReady()
  const sizing = chatSizing(page)
  await sizing.expectWidth(380)
  await expect(sizing.handle).toHaveCSS("width", "8px")
  const original = (await chat.root.boundingBox())!
  expect((await sizing.handle.boundingBox())!.height).toBe((await chat.frame.boundingBox())!.height)
  await chat.composer().fill("Keep this draft while resizing")
  await sizing.dragBy(140)
  await sizing.expectWidth(Math.round(original.width) + 140)
  await sizing.dragBy(100, true)
  await sizing.expectWidth(Math.round(original.width) + 140)
  const divider = (await sizing.handle.boundingBox())!
  const x = divider.x + divider.width / 2
  const y = divider.y + divider.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 120, y)
  await expect(sizing.handle).toHaveAttribute("aria-valuenow", "640")
  await page.setViewportSize({ width: 1400, height: 900 })
  await sizing.expectWidth(520)
  await expect(sizing.handle).toHaveAttribute("aria-valuenow", "520")
  await expect(sizing.handle).toHaveAttribute("aria-valuetext", "520 pixels")
  await page.mouse.up()
  expect((await chat.root.boundingBox())!.height).toBe(original.height)
  await expect(chat.composer()).toHaveValue("Keep this draft while resizing")
  await sizing.handle.press("Home")
  await sizing.expectWidth(320)
  await sizing.setWidth(560)
  await captureMoment(page, "horizontal-chat-resize")

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(sizing.handle).toBeHidden()
  expect(await chat.frame.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await sizing.expectWidth(560)
  await page.reload()
  await chat.waitForReady()
  await sizing.expectWidth(560)

  const otherPage = await context.newPage()
  await otherPage.setViewportSize({ width: 1440, height: 900 })
  await todosPage(otherPage).open()
  const otherSizing = chatSizing(otherPage)
  await otherSizing.expectWidth(560)
  await otherSizing.handle.press("ArrowRight")
  await otherSizing.expectWidth(550)
  await sizing.expectWidth(560)
  await otherPage.close()
})

test.describe("touch resizing", () => {
  test.use({ hasTouch: true })

  test("a coarse pointer can drag from the enlarged target", async ({ page, context }) => {
    const sizing = chatSizing(page)
    await sizing.openHost()
    await expect(sizing.handle).toHaveCSS("width", "44px")
    const bounds = (await sizing.handle.boundingBox())!
    const x = bounds.x + 30
    const y = bounds.y + bounds.height / 2
    const pointer = await context.newCDPSession(page)
    await pointer.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    })
    for (let step = 1; step <= 8; step++)
      await pointer.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x - (120 * step) / 8, y }],
      })
    await pointer.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await sizing.expectWidth(600)
  })
})

test("initial width opens a zero-width host and survives clamping and host controls", async ({
  page,
}) => {
  const sizing = chatSizing(page)
  const chat = chatWidget(page)
  await sizing.openHost()
  await sizing.expectWidth(480)
  await sizing.handle.click()
  expect(await page.evaluate((key) => localStorage.getItem(key), WIDTH_STORAGE_KEY)).toBeNull()
  await sizing.fillWidth.check()
  await sizing.expectWidth(960)
  await sizing.fillWidth.uncheck()
  await sizing.expectWidth(480)
  await sizing.setWidth(640)
  await sizing.setBoundaryWidth(300)
  await sizing.expectWidth(300)
  await sizing.setBoundaryWidth(960)
  await sizing.expectWidth(640)
  await sizing.fillWidth.check()
  await sizing.expectWidth(640)
  await sizing.resizable.uncheck()
  await expect(sizing.handle).toBeHidden()
  await sizing.resizable.check()
  await expect(sizing.handle).toBeVisible()
  await sizing.setWidth(960)
  expect(await page.evaluate((key) => localStorage.getItem(key), WIDTH_STORAGE_KEY)).toBeNull()
  await sizing.setBoundaryWidth(1100)
  await sizing.expectWidth(1100)
  await sizing.changeDefault.click()
  await sizing.expectWidth(520)
  expect((await chat.root.boundingBox())!.height).toBe(640)
  await captureMoment(page, "chat-width-restored")
})

test("malformed or failing storage does not interrupt resizing or an active request", async ({
  page,
}) => {
  await page.addInitScript((key) => localStorage.setItem(key, "{invalid"), WIDTH_STORAGE_KEY)
  const sizing = chatSizing(page)
  const chat = chatWidget(page)
  await sizing.openHost()
  await sizing.expectWidth(480)
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage is full", "QuotaExceededError")
    }
  })
  let finish: (() => void) | undefined
  let sends = 0
  await page.route("**/api/v1/chat", async (route) => {
    sends++
    await new Promise<void>((resolve) => (finish = resolve))
    await route.fulfill({ status: 503, body: "Unavailable" })
  })
  await chat.send("Keep the active request while resizing")
  await expect.poll(() => finish !== undefined).toBe(true)
  await sizing.setWidth(600)
  await expect(chat.stopButton()).toBeVisible()
  expect(sends).toBe(1)
  finish!()
  await expect(chat.errorAlert()).toBeVisible()
  await sizing.expectWidth(600)
})

for (const closed of ["hidden", "collapsed"] as const) {
  test(`a chat mounted ${closed} retains its CSS fallback and clears a returned default`, async ({
    page,
  }) => {
    await page.addInitScript(
      (key) => localStorage.setItem(key, JSON.stringify({ width: 640 })),
      WIDTH_STORAGE_KEY,
    )
    const sizing = chatSizing(page)
    await sizing.openHost({ [closed]: true })
    if (closed === "collapsed") await sizing.expectWidth(0)
    await sizing.showContainer.click()
    await chatWidget(page).waitForReady()
    await sizing.expectWidth(640)
    await sizing.setWidth(400)
    expect(await page.evaluate((key) => localStorage.getItem(key), WIDTH_STORAGE_KEY)).toBeNull()
  })
}

test("storage combines organization, component and agent identities", async ({ page }) => {
  const sizing = chatSizing(page)
  await sizing.openHost({ agentId: firstAgent, hostId: "" })
  await sizing.setWidth(560)
  await sizing.openHost({ agentId: secondAgent, hostId: "" })
  await sizing.expectWidth(480)
  await sizing.setWidth(640)
  await sizing.openHost({ agentId: firstAgent, hostId: "" })
  await sizing.expectWidth(560)

  await sizing.openHost({ agentId: firstAgent, hostId: "primary-chat" })
  await sizing.expectWidth(480)
  await sizing.setWidth(600)
  await sizing.openHost({ agentId: firstAgent, hostId: "secondary-chat" })
  await sizing.expectWidth(480)
  await sizing.openHost({ agentId: secondAgent, hostId: "primary-chat" })
  await sizing.expectWidth(480)
  await sizing.setWidth(700)
  await sizing.openHost({ agentId: firstAgent, hostId: "primary-chat" })
  await sizing.expectWidth(600)
  await sizing.openHost({ agentId: secondAgent, hostId: "primary-chat" })
  await sizing.expectWidth(700)

  await page.evaluate(() => localStorage.setItem("astralbeam:chat-size:v1", '{"width":760}'))
  await sizing.openHost({ agentId: "default", hostId: "" })
  await sizing.expectWidth(480)
  await sizing.setWidth(560)
  await sizing.openHost({ agentId: "default", hostId: "" })
  await sizing.expectWidth(480)
  expect(await page.evaluate(() => localStorage.getItem("astralbeam:chat-size:v1"))).toBe(
    '{"width":760}',
  )
})
