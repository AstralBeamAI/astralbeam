import { expect, type Locator, type Page } from "@playwright/test"

import { waitForHydration } from "../hydration.ts"

/** `/onboarding`, the only page a signed-in user without an organization can reach. */
export function onboardingPage(page: Page) {
  return {
    async expectVisible(): Promise<void> {
      await page.waitForURL(/\/onboarding/)
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: /^(Create your organization|Join your team)$/,
        }),
      ).toBeVisible()
    },

    pendingInvitations(): Locator {
      return page.getByRole("heading", { name: /invitations/i })
    },

    async openCreateOrganization(): Promise<void> {
      const button = page.getByRole("button", { name: "Create organization", exact: true })
      await waitForHydration(button)
      await button.click()
    },
  }
}

export type OnboardingPage = ReturnType<typeof onboardingPage>
