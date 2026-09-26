import process from "node:process"
import { expect, test } from "@playwright/test"

test("Astro changes real host state, then edits survive refresh and Reset", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.E2E_LIVE_ASTRO !== "true",
    "Requires a configured AstralBeam agent and model key",
  )
  test.setTimeout(180_000)
  if (process.env.E2E_CAPTURE) {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style")
        style.textContent = "html { zoom: 1.4 } .app-shell { height: calc(100dvh / 1.4) }"
        document.head.append(style)
      })
    })
  }
  await page.goto("/")
  const composer = page.getByRole("textbox", { name: "Message" })
  await expect(page.getByPlaceholder("Message Astro…")).toBeEnabled({ timeout: 30_000 })
  await page.screenshot({ path: testInfo.outputPath("overview.png"), animations: "disabled" })
  await page.waitForTimeout(1800)
  await page.getByRole("button", { name: /^Issues/ }).click()
  await page.getByRole("textbox", { name: "Search issues" }).fill("enterprise launch")
  await composer.fill(
    "Create an issue called Enterprise launch review in Enterprise readiness. Assign Maya Patel, set High priority, Todo, Cycle 24, and Security. Add a short description and show its issue card.",
  )
  await composer.press("Enter")
  const created = page.getByRole("button", {
    name: "ACM-146 Enterprise launch review",
    exact: true,
  })
  await expect(created).toBeVisible({ timeout: 120_000 })
  await expect(page.locator(".astro-issue-card")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0, {
    timeout: 60_000,
  })
  await page.screenshot({
    path: testInfo.outputPath("astro-created-issue.png"),
    animations: "disabled",
  })
  await page.waitForTimeout(2000)
  await page.locator(".astro-issue-card").click()
  await expect(page.getByRole("combobox", { name: "Assignee", exact: true })).toHaveValue(
    /74dcb815/,
  )
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("In progress")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.locator(".astro-issue-card")).toContainText("In progress")
  await page.getByRole("button", { name: "Board view" }).click()
  await page.screenshot({ path: testInfo.outputPath("board.png"), animations: "disabled" })
  await page.waitForTimeout(1700)
  await page.reload()
  await page.getByRole("button", { name: /^Issues/ }).click()
  await page.getByRole("textbox", { name: "Search issues" }).fill("enterprise launch")
  await expect(
    page
      .getByRole("region", { name: "In progress issues", exact: true })
      .getByRole("button", { name: /Enterprise launch review/ }),
  ).toBeVisible()
  await page.waitForTimeout(1200)
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption({ label: "Orbit workspace" })
  await expect(created).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("orbit.png"), animations: "disabled" })
  await page.waitForTimeout(1700)
  await page.getByRole("button", { name: "Reset demo" }).click()
  await page.waitForTimeout(1000)
  await page.getByRole("button", { name: "Reset everything" }).click()
  await expect(page.getByRole("combobox", { name: "Workspace", exact: true })).toHaveValue(
    "8f25a5c7-28cc-49d4-b4c6-21c20a781d01",
  )
  await expect(created).toHaveCount(0)
  await page.waitForTimeout(1400)
})
