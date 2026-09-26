import process from "node:process"
import { writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"

test("Astro helps the team unblock the Atlas pilot", async ({ page }, testInfo) => {
  test.skip(
    process.env.E2E_LIVE_ASTRO !== "true",
    "Requires a configured AstralBeam agent and model key",
  )
  test.setTimeout(180_000)
  const started = Date.now()
  const beats: Record<string, number> = {}
  const mark = (name: string) => {
    beats[name] = (Date.now() - started) / 1000
  }
  if (process.env.E2E_CAPTURE) {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.zoom = "1.4"
      })
    })
  }
  const workspace = "8f25a5c7-28cc-49d4-b4c6-21c20a781d01"
  const issue = "74dcb815-bc71-4f65-a100-000000000100"
  const composer = page.getByRole("textbox", { name: "Message", exact: true })
  const follow = page
    .getByRole("button", { name: "Scroll to end", exact: true })
    .and(page.locator('[data-active="true"]'))
  const settled = async () => {
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0, {
      timeout: 60_000,
    })
    if (await follow.isVisible()) await follow.click()
    await page.waitForTimeout(500)
  }
  const say = async (prompt: string, beat: string) => {
    mark(`${beat}Typing`)
    await composer.pressSequentially(prompt, { delay: 40 })
    await page.waitForTimeout(400)
    await composer.press("Enter")
    mark(`${beat}Sent`)
  }
  await page.goto(`/${workspace}/projects/74dcb815-bc71-4f65-a100-000000000020`)
  await expect(page.getByPlaceholder("Message Astro…")).toBeEnabled({ timeout: 30_000 })
  await expect(
    page.getByRole("heading", { name: "Enterprise readiness", exact: true }),
  ).toBeVisible()
  mark("opening")
  await page.screenshot({
    path: testInfo.outputPath("01-enterprise-launch.png"),
    animations: "disabled",
  })
  await page.waitForTimeout(2000)

  await say("What's blocking the Atlas pilot? Show a card here.", "find")
  const card = page.locator(".astro-issue-card")
  await expect(card.first()).toContainText("Add workspace-level SSO enforcement", {
    timeout: 90_000,
  })
  await settled()
  mark("found")
  await page.screenshot({
    path: testInfo.outputPath("02-launch-blocker.png"),
    animations: "disabled",
  })
  await page.waitForTimeout(2800)

  await say("Open it and let me choose an owner here.", "open")
  await expect(page).toHaveURL(new RegExp(`/${workspace}/issues/${issue}$`), { timeout: 90_000 })
  await expect(
    page.getByRole("heading", { name: "Add workspace-level SSO enforcement" }),
  ).toBeVisible()
  await expect(page.getByRole("region", { name: "Choose an issue owner" })).toBeVisible({
    timeout: 90_000,
  })
  await settled()
  await expect(page.getByRole("combobox", { name: "Assignee", exact: true })).toHaveValue("")
  mark("picker")
  await page.screenshot({
    path: testInfo.outputPath("03-choose-owner.png"),
    animations: "disabled",
  })
  await page.waitForTimeout(2500)
  await page.getByRole("button", { name: "Assign to Maya Patel", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Assignee", exact: true })).toHaveValue(
    "74dcb815-bc71-4f65-a100-000000000002",
  )
  await expect(page.getByText("Assigned to Maya Patel", { exact: true })).toBeVisible()
  mark("assigned")
  await page.waitForTimeout(1800)

  await say("Make it urgent, start work, and show the updated card.", "update")
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue(
    "In progress",
    { timeout: 90_000 },
  )
  await expect(page.getByRole("combobox", { name: "Priority", exact: true })).toHaveValue("Urgent")
  await expect(card).toHaveCount(2, { timeout: 90_000 })
  await settled()
  await expect(card.last()).toContainText("Maya Patel")
  await expect(card.last()).toContainText("In progress")
  await expect(card.last()).toContainText("Urgent")
  mark("resolved")
  await page.screenshot({
    path: testInfo.outputPath("04-owned-and-moving.png"),
    animations: "disabled",
  })
  await page.waitForTimeout(6000)
  mark("end")
  await writeFile(testInfo.outputPath("story.json"), JSON.stringify(beats, null, 2))
})
