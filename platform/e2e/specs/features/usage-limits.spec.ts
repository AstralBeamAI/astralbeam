import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { waitForHydration } from "@e2e/hydration.ts"
import { makeRunIdentity } from "@e2e/identity.ts"

test("the owner creates, reviews, edits, and deletes usage limits", async ({
  page,
  baseline,
  shell,
  usageLimits,
}) => {
  const { runId } = makeRunIdentity()
  const weekly = `Weekly limit ${runId}`
  const session = `Session limit ${runId}`
  const conversation = `Conversation limit ${runId}`
  await page.goto(`/${baseline.organizationSlug}/usage-limits`)

  await test.step("a fixed weekly token limit applies to everyone", async () => {
    await usageLimits.startCreate()
    await expect(usageLimits.summary).toContainText("Name: Must not be empty")
    await usageLimits.fillForm({ name: weekly, amount: "0" })
    await expect(usageLimits.summary).toContainText("Limit: Enter a whole number of tokens")
    await expect(usageLimits.summary).not.toContainText("Name:")
    await usageLimits.fillForm({
      name: weekly,
      duration: "Custom",
      custom: { count: "0", unit: "Hours" },
      amount: "2000000",
    })
    await expect(usageLimits.summary).toContainText("Duration: Must be 1 or greater")
    await expect(usageLimits.summary).not.toContainText("Limit:")
    await usageLimits.fillForm({
      name: weekly,
      duration: "Weekly",
      timeZone: "America/New_York",
      amount: "2000000",
    })
    await expect(usageLimits.summary).toContainText(
      "Resets on calendar boundaries in America/New_York",
    )
    await captureMilestone(page, "01-new-weekly-limit")
    await usageLimits.submitCreate(weekly)
    await expect(page.getByText(/^limit_[0-9a-f-]{36}_[0-9a-f-]{36}$/)).toBeVisible()
  })

  await test.step("a usage page past the end returns to the last page", async () => {
    const limitPage = page.url()
    await page.goto(`${limitPage}?page=3`)
    await expect(page.getByText("No usage in the current window yet.")).toBeVisible()
    expect(new URL(page.url()).searchParams.get("page")).toBeNull()
  })

  await test.step("a rolling five-hour spend limit applies only when a token lists it", async () => {
    await shell.openSection("Usage Limits", "Usage Limits")
    await usageLimits.startCreate()
    await usageLimits.fillForm({
      name: session,
      appliesByDefault: false,
      duration: "Custom",
      custom: { count: "5", unit: "Hours" },
      windowType: "Rolling",
      metric: "Spend (USD)",
      amount: "2.505",
    })
    await page.getByRole("button", { name: "Create limit" }).click()
    await expect(usageLimits.amountError).toContainText("at most two decimal places")
    await page.locator("#usage-limit-amount").fill("2.50")
    await usageLimits.submitCreate(session)
  })

  await test.step("a per-conversation limit appears in the table beside the others", async () => {
    await shell.openSection("Usage Limits", "Usage Limits")
    await usageLimits.startCreate()
    await usageLimits.fillForm({
      name: conversation,
      scope: "Per conversation",
      duration: "Daily",
      windowType: "Rolling",
      amount: "200000",
    })
    await usageLimits.submitCreate(conversation)
    await shell.openSection("Usage Limits", "Usage Limits")
    await expect(usageLimits.row(weekly)).toContainText(
      /Per tenant user.*Weekly, fixed in America\/New York.*2,000,000 tokens.*Everyone/,
    )
    await expect(usageLimits.row(session)).toContainText(
      /Every 5 hours, rolling.*\$2\.50.*Listed in token/,
    )
    await expect(usageLimits.row(conversation)).toContainText(/Per conversation.*Daily, rolling/)
    await captureMilestone(page, "02-usage-limits-table")
  })

  await test.step("a global limit is always a default, and edits persist", async () => {
    await usageLimits.row(session).getByRole("link", { name: session }).click()
    await waitForHydration(page.locator("#usage-limit-name"))
    await usageLimits.fillForm({ name: session, scope: "Global", amount: "3" })
    await expect(page.getByRole("checkbox", { name: "Apply to every tenant user" })).toBeChecked()
    await expect(page.getByRole("checkbox", { name: "Apply to every tenant user" })).toBeDisabled()
    await usageLimits.saveChanges()
    await captureMilestone(page, "03-edited-limit")
    await shell.openSection("Usage Limits", "Usage Limits")
    await expect(usageLimits.row(session)).toContainText(/Global.*\$3\.00.*Everyone/)
  })

  await test.step("the list's switch disables a limit in place", async () => {
    const enabled = usageLimits.enabledSwitch(session)
    await expect(enabled).toBeChecked()
    await enabled.click()
    await expect(page.getByText(`${session} disabled`)).toBeVisible()
    await expect(enabled).not.toBeChecked()
    await page.reload()
    await expect(usageLimits.enabledSwitch(session)).not.toBeChecked()
    await captureMilestone(page, "04-disabled-from-list")
  })

  await test.step("deleting a limit removes it from the table", async () => {
    await usageLimits.row(conversation).getByRole("link", { name: conversation }).click()
    await usageLimits.remove(conversation)
    await expect(usageLimits.row(conversation)).toHaveCount(0)
  })
})
