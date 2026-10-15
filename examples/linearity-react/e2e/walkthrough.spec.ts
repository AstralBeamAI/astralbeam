import process from "node:process"
import { readFile, writeFile } from "node:fs/promises"
import { Buffer } from "node:buffer"
import { expect, test } from "@playwright/test"

test("Astro helps the team unblock the Atlas pilot", async ({ page }, testInfo) => {
  test.skip(
    process.env.E2E_LIVE_ASTRO !== "true",
    "Requires a configured AstralBeam agent and model key",
  )
  test.setTimeout(360_000)
  page.setDefaultTimeout(20_000)
  const started = Date.now()
  const beats: Record<string, number> = {}
  const mark = (name: string) => {
    beats[name] = (Date.now() - started) / 1000
  }
  const workspace = "8f25a5c7-28cc-49d4-b4c6-21c20a781d01"
  const issue = "74dcb815-bc71-4f65-a100-000000000100"
  const composer = page.getByRole("textbox", { name: "Message", exact: true })
  const follow = page
    .getByRole("button", { name: "Scroll to end", exact: true })
    .and(page.locator('[data-active="true"]'))
  const settled = async () => {
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0, {
      timeout: 90_000,
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
  if (process.env.E2E_CAPTURE) {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1.4"
    })
  }
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
  await page.waitForTimeout(3500)

  const brief = "Atlas security brief.txt"
  const contents =
    "Atlas enterprise pilot: launch readiness\n\nThe SSO enforcement issue is the launch blocker. Before opening the pilot, Maya must verify SAML sign-in for every workspace member, an administrator recovery path, and expiry of existing sessions after enforcement. Security sign-off is still pending. Assignment and priority do not mean these checks have passed.\n"
  await page.getByRole("button", { name: "Attach files", exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: brief,
    mimeType: "text/plain",
    buffer: Buffer.from(contents),
  })
  await expect(page.getByRole("button", { name: `Remove ${brief}` })).toBeVisible()
  await expect(page.locator('[data-slot="attachment"][data-state="uploading"]')).toHaveCount(0, {
    timeout: 30_000,
  })
  mark("attached")
  await page.waitForTimeout(2000)
  await say("Read this brief. What still needs checking? Three bullets, under 45 words.", "brief")
  await expect(page.getByRole("button", { name: `Download ${brief}` })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole("button", { name: "Ran read_attachment", exact: true })).toBeVisible({
    timeout: 90_000,
  })
  await settled()
  mark("reviewed")
  await page.screenshot({ path: testInfo.outputPath("05-security-brief.png") })
  await page.waitForTimeout(4500)

  await say(
    "Search official GitHub docs for safe SAML SSO rollout. Two checks, under 50 words, with sources.",
    "web",
  )
  const sources = page.getByRole("button", { name: /^Consulted \d+ sources?$/ }).last()
  await expect(sources).toBeVisible({ timeout: 90_000 })
  await settled()
  mark("researched")
  await page.screenshot({ path: testInfo.outputPath("06-web-research.png") })
  await page.waitForTimeout(4500)
  await sources.click()
  mark("sources")
  await page.waitForTimeout(2500)
  await sources.click()
  await settled()
  await composer.hover()
  const citation = page.getByRole("link", { name: /^Source \d+:/ }).last()
  await expect(citation).toBeVisible()
  await citation.hover()
  await expect(page.locator('[data-slot="hover-card-content"]')).toBeVisible()
  mark("citation")
  await page.screenshot({ path: testInfo.outputPath("07-source-preview.png") })
  await page.waitForTimeout(2500)
  await page.getByRole("heading", { name: "Add workspace-level SSO enforcement" }).hover()

  await page.getByRole("button", { name: "Conversation actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  await page
    .getByRole("textbox", { name: "Conversation title", exact: true })
    .fill("Atlas pilot readiness")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.locator('[data-slot="conversation-title"]')).toContainText(
    "Atlas pilot readiness",
  )
  mark("named")
  await page.waitForTimeout(1500)
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  await expect(page.getByText("Less searching.")).toBeVisible()
  mark("newChat")
  await page.waitForTimeout(1200)
  await page.getByRole("combobox", { name: "Show older chats", exact: true }).click()
  await page.getByRole("combobox", { name: "Search chats", exact: true }).fill("Atlas")
  await expect(
    page.getByRole("option", { name: "Atlas pilot readiness", exact: true }),
  ).toBeVisible()
  mark("history")
  await page.screenshot({ path: testInfo.outputPath("08-saved-conversation.png") })
  await page.waitForTimeout(2500)
  await page.getByRole("option", { name: "Atlas pilot readiness", exact: true }).click()
  await expect(page.locator('[data-slot="conversation-title"]')).toContainText(
    "Atlas pilot readiness",
  )
  const savedBrief = page.getByRole("button", { name: `Download ${brief}` })
  await savedBrief.scrollIntoViewIfNeeded()
  await expect(savedBrief).toBeVisible()
  const downloadPromise = page.waitForEvent("download")
  await savedBrief.click()
  const download = await downloadPromise
  expect(await readFile(await download.path(), "utf8")).toBe(contents)
  mark("restored")
  await page.screenshot({ path: testInfo.outputPath("09-restored-brief.png") })
  await page.waitForTimeout(4500)
  mark("end")
  await writeFile(testInfo.outputPath("story.json"), JSON.stringify(beats, null, 2))
})
