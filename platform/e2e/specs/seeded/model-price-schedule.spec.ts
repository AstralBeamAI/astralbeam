import { SEED_ORGANIZATIONS, SEED_PASSWORD, SEED_USERS } from "@scripts/seed/fixtures.ts"
import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { waitForHydration } from "@e2e/hydration.ts"

test("manual prices can be scheduled, edited and cancelled while viewers cannot manage prices", async ({
  page,
  models,
  auth,
}) => {
  test.setTimeout(90_000)
  const org = SEED_ORGANIZATIONS[0]
  const model = "gpt-6.1-sol"
  const name = `Pricing schedule ${Date.now()}`
  await page.goto(`/${org.slug}/models`)
  await models.create({ name, modelId: model, apiKey: "synthetic-scheduling-key" })
  const providerUrl = page.url()
  await page
    .getByRole("switch", { name: `Override catalog defaults for ${model}`, exact: true })
    .check()
  await page.getByLabel(`Input price for ${model}`, { exact: true }).fill("2")
  await page.getByLabel(`Output price for ${model}`, { exact: true }).fill("8")
  await models.save()
  await page.reload()
  await waitForHydration(page.locator("#model-provider-name"))
  const schedule = page.getByRole("group", { name: `Price schedule for ${model}`, exact: true })
  await schedule.getByRole("button", { name: "Schedule price change" }).click()
  const future = new Date(Date.now() + 86_400_000)
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
  await schedule.getByLabel("Effective from", { exact: true }).fill(local)
  await schedule.getByLabel(/Input price/).fill("3")
  await schedule.getByLabel(/Output price/).fill("12")
  await models.save()
  await page.reload()
  await waitForHydration(page.locator("#model-provider-name"))
  await expect(page.getByLabel(`Input price for ${model}`, { exact: true })).toHaveValue("2")
  await schedule.locator("summary").filter({ hasText: "Scheduled" }).click()
  await expect(schedule.getByLabel("Effective from", { exact: true })).toHaveValue(local)
  await expect(schedule.getByLabel(/Input price/)).toHaveValue("3")
  await schedule.scrollIntoViewIfNeeded()
  await captureMilestone(page, "01-saved-price-schedule")
  await schedule.getByLabel(/Input price/).fill("4")
  await models.save()
  await page.reload()
  await waitForHydration(page.locator("#model-provider-name"))
  await schedule.locator("summary").filter({ hasText: "Scheduled" }).click()
  await expect(schedule.getByLabel(/Input price/)).toHaveValue("4")
  await page.setViewportSize({ width: 390, height: 844 })
  await schedule.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await captureMilestone(page, "02-edited-price-schedule-mobile")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/auth/sign-out")
  await page.waitForURL(/\/auth\/sign-in/)
  await auth.signIn(SEED_USERS[2].email, SEED_PASSWORD)
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"))
  await page.goto(providerUrl)
  await expect(page).toHaveURL(new RegExp(`/${org.slug}/?$`))
  await expect(schedule).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Save provider", exact: true })).toHaveCount(0)
  await captureMilestone(page, "03-viewer-cannot-manage-prices")
  await page.goto("/auth/sign-out")
  await page.waitForURL(/\/auth\/sign-in/)
  await auth.signIn(SEED_USERS[0].email, SEED_PASSWORD)
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"))
  await page.goto(providerUrl)
  await waitForHydration(page.locator("#model-provider-name"))
  await schedule.locator("summary").filter({ hasText: "Scheduled" }).click()
  await schedule.getByRole("button", { name: "Cancel scheduled price" }).click()
  await models.save()
  await page.reload()
  await waitForHydration(page.locator("#model-provider-name"))
  await expect(schedule.locator("details")).toHaveCount(0)
  await expect(page.getByLabel(`Input price for ${model}`, { exact: true })).toHaveValue("2")
  await schedule.scrollIntoViewIfNeeded()
  await captureMilestone(page, "04-price-schedule-cancelled")
  await models.requestDelete()
})
