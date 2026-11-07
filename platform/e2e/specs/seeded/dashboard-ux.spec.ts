import {
  SEED_CONVERSATIONS,
  SEED_ORGANIZATIONS,
  SEED_PASSWORD,
  SEED_USERS,
} from "@scripts/seed/fixtures.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { captureMilestone } from "@e2e/capture.ts"
import { waitForHydration } from "@e2e/hydration.ts"

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
  await expect(astro.panel.getByText(SEED_CONVERSATIONS.astro[0].turns[0][0])).toBeVisible()
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

test("UX evidence: a viewer sees permitted navigation and guide-only customization", async ({
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
  await expect(page.getByRole("heading", { name: "Customize your setup" })).toBeVisible()
  await expect(page.getByRole("link", { name: /^Match your brand/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /^Shape your agent/ })).toHaveCount(0)
  await captureMilestone(page, "viewer-customize")
})

test("UX evidence: the setup prompt copies or falls back to a selectable field", async ({
  page,
  auth,
  apiKeys,
}) => {
  const globex = SEED_ORGANIZATIONS[1]
  await page.context().clearCookies()
  await auth.open("sign-in")
  await auth.signIn(globex.members[0].email, SEED_PASSWORD)
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"))
  await page.goto(`/${globex.slug}`)
  const copyPrompt = page.getByRole("button", { name: "Copy setup prompt", exact: true })
  await waitForHydration(copyPrompt)
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await copyPrompt.click()
  await expect(page.getByText("Prompt copied. Paste it into your coding agent.")).toBeVisible()
  const copiedPrompt = await page.evaluate(() => navigator.clipboard.readText())
  expect(copiedPrompt).toContain("https://astralbeam.ai/agent-skills/astralbeam/SKILL.md")

  await page.setViewportSize({ width: 390, height: 844 })
  await apiKeys.setClipboardResult("unavailable")
  await copyPrompt.click()
  const prompt = page.getByRole("textbox", { name: "Integration prompt", exact: true })
  await expect(prompt).toBeVisible()
  await expect(prompt).toHaveValue(copiedPrompt)
  await prompt.click()
  await captureMilestone(page, "integration-prompt-mobile-fallback")
})
