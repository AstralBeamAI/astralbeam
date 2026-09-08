import { expect, type Locator, type Page } from "@playwright/test"

/** `/onboarding`, the only page a signed-in user without an organization can reach. */
export function onboardingPage(page: Page) {
  return {
    async expectVisible(): Promise<void> {
      await page.waitForURL(/\/onboarding/)
      await expect(page.getByRole("heading", { name: "Join or create an organization" }))
        .toBeVisible()
    },

    pendingInvitations(): Locator {
      return page.getByRole("heading", { name: /invitations/i })
    },

    async openCreateOrganization(): Promise<void> {
      await page.getByRole("button", { name: "Create a new organization" }).click()
    },
  }
}

export type OnboardingPage = ReturnType<typeof onboardingPage>
