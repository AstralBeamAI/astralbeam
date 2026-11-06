import { SEED_ORGANIZATIONS, SEED_PASSWORD } from "@scripts/seed/fixtures.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { captureMilestone } from "@e2e/capture.ts"
import { waitForHydration } from "@e2e/hydration.ts"

test("integration guide steps collapse and keep manual completion across reloads", async ({
  page,
  auth,
}) => {
  // Globex has an API key but no conversations, so it shows the guide with step 1 detected.
  const globex = SEED_ORGANIZATIONS[1]
  await page.context().clearCookies()
  await auth.open("sign-in")
  await auth.signIn(globex.members[0].email, SEED_PASSWORD)
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"))
  await page.goto(`/${globex.slug}`)
  const step = (name: string) => page.getByRole("button", { name, exact: true })
  const install = step("Install the SDK")
  const installItem = page.getByRole("listitem").filter({ has: install })
  const done = installItem.getByRole("button", { name: "Mark as done", exact: true })
  const undo = page
    .getByRole("listitem")
    .filter({ has: step("Install the SDK (complete)") })
    .getByRole("button", { name: "Mark not done", exact: true })
  await waitForHydration(done)
  await expect(step("Create an API key (complete)")).toHaveAttribute("aria-expanded", "false")
  await expect(install).toHaveAttribute("aria-expanded", "true")
  // Only the caret toggles a step, so clicking its title leaves it open.
  await installItem.getByRole("heading", { name: "Install the SDK" }).click()
  await expect(install).toHaveAttribute("aria-expanded", "true")
  await captureMilestone(page, "guide-initial")

  await done.click()
  await expect(undo).toBeVisible()
  const installComplete = step("Install the SDK (complete)")
  await expect(installComplete).toHaveAttribute("aria-expanded", "false")
  await step("Create the token endpoint").click()
  await expect(step("Create the token endpoint")).toHaveAttribute("aria-expanded", "false")
  await captureMilestone(page, "guide-collapsed")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(undo).toBeVisible()
  await captureMilestone(page, "guide-mobile")
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.reload()
  await waitForHydration(undo)
  await expect(installComplete).toHaveAttribute("aria-expanded", "false")
  await installComplete.click()
  await expect(installComplete).toHaveAttribute("aria-expanded", "true")
  await undo.click()
  await expect(done).toBeVisible()
  await expect(install).toHaveAttribute("aria-expanded", "true")
})
