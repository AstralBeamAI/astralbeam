import {
  SEED_CONVERSATIONS,
  SEED_ORGANIZATIONS,
  SEED_PASSWORD,
  SEED_USERS,
} from "@scripts/seed/fixtures.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { captureMilestone } from "@e2e/capture.ts"

test("completed setup starts collapsed and its steps remain expandable", async ({ page }) => {
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}`)
  const setup = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("progressbar", { name: "Organization setup" }),
  })
  await expect(setup).toContainText("4 of 4 setup steps complete")
  const steps = setup.getByRole("button")
  await expect(steps).toHaveCount(4)
  for (const step of await steps.all()) {
    await expect(step).toHaveAttribute("aria-expanded", "false")
  }
  await steps.first().click()
  await expect(setup.getByRole("link", { name: "Manage models", exact: true })).toBeVisible()
  await steps.first().click()
  await expect(steps.first()).toHaveAttribute("aria-expanded", "false")
  await captureMilestone(page, "completed-setup-collapsed")
})

test("UX evidence: mobile Astro preserves drafts and confirms conversation deletion", async ({
  page,
  astro,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}`)
  await astro.open()
  const composer = astro.panel.getByRole("textbox", { name: "Message", exact: true })
  await composer.fill("Keep this draft when I close Astro")
  await astro.panel.getByRole("button", { name: "Close chat", exact: true }).click()
  await expect(page.getByRole("button", { name: "Ask Astro", exact: true })).toBeFocused()
  await astro.open()
  await expect(composer).toHaveValue("Keep this draft when I close Astro")
  await expect(astro.panel).toHaveCSS("width", "390px")
  await captureMilestone(page, "astro-mobile-draft")
  await astro.openConversation(SEED_CONVERSATIONS.astro[0].title)
  await astro.panel.getByRole("button", { name: "Conversation actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click()
  const confirmation = page.getByRole("alertdialog")
  await expect(confirmation).toContainText(SEED_CONVERSATIONS.astro[0].title)
  await expect(confirmation).toHaveCSS("opacity", "1")
  await expect(page.getByRole("menu")).toBeHidden()
  await captureMilestone(page, "astro-delete-confirmation")
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(
    astro.panel.getByRole("button", { name: "Conversation actions", exact: true }),
  ).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(astro.panel).toBeHidden()
})

test("UX evidence: a restricted member sees permitted navigation and setup guidance", async ({
  page,
  auth,
  shell,
}) => {
  await page.context().clearCookies()
  await auth.open("sign-in")
  await auth.signIn(SEED_USERS[2].email, SEED_PASSWORD)
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"))
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}`)
  await expect(shell.navigation).toBeVisible()
  await expect(shell.sectionLink("Settings")).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Follow the quickstart", exact: true })).toBeVisible()
  await captureMilestone(page, "restricted-dashboard")
})
