import { expect, type Locator, type Page } from "@playwright/test"

import { waitForHydration } from "../hydration.ts"
import { submitCreateOrganizationForm } from "./create-organization-dialog.ts"

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

    async createOrganization(name: string, slug: string): Promise<void> {
      // React would replace values typed into the server-rendered inputs while hydrating.
      await waitForHydration(page.locator("#create-organization-name"))
      await submitCreateOrganizationForm(page.locator("main"), name, slug)
    },
  }
}

export type OnboardingPage = ReturnType<typeof onboardingPage>
