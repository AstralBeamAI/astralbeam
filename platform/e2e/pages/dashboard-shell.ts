import { expect, type Locator, type Page } from "@playwright/test"

import { waitForHydration } from "../hydration.ts"

export type OrganizationSection =
  | "Home"
  | "Agents"
  | "Sandboxes"
  | "API keys"
  | "Members"
  | "Settings"

/**
 * The sidebar every organization page shares: navigation, the organization switcher, and the user
 * menu. Tracks `src/routes/_authenticated/-components/app-sidebar.tsx`.
 */
export function dashboardShell(page: Page) {
  const navigation = page.getByRole("navigation", { name: "Organization navigation" })

  return {
    navigation,

    sectionLink(section: OrganizationSection): Locator {
      return navigation.getByRole("link", { name: section, exact: true })
    },

    /** Clicks a sidebar entry and waits for that page's heading, so a spec starts settled. */
    async openSection(section: OrganizationSection, heading: string | RegExp): Promise<void> {
      await this.sectionLink(section).click()
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
    },

    /** The sidebar hides sections the member's role cannot reach, which is navigation, not access. */
    async visibleSections(): Promise<string[]> {
      return await navigation.getByRole("link").allInnerTexts()
    },

    organizationSwitcher(organizationName: string): Locator {
      return page.getByRole("button", { name: organizationName, exact: true })
    },

    async switchOrganization(from: string, to: string): Promise<void> {
      await waitForHydration(this.organizationSwitcher(from))
      await this.organizationSwitcher(from).click()
      await page.getByRole("menuitem").filter({ hasText: to }).click()
      await expect(this.organizationSwitcher(to)).toBeVisible()
    },

    async openCreateOrganization(currentOrganizationName: string): Promise<void> {
      await waitForHydration(this.organizationSwitcher(currentOrganizationName))
      await this.organizationSwitcher(currentOrganizationName).click()
      await page.getByRole("menuitem", { name: /create organization/i }).click()
    },

    async openUserMenu(): Promise<void> {
      const trigger = page.getByRole("button", { name: "Account", exact: true })
      await waitForHydration(trigger)
      await trigger.click()
    },

    async openUserMenuItem(name: RegExp, heading: string | RegExp): Promise<void> {
      await this.openUserMenu()
      await page.getByRole("menuitem", { name }).click()
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
    },

    async signOut(): Promise<void> {
      await this.openUserMenu()
      await page.getByRole("menuitem", { name: /sign out/i }).click()
      await page.waitForURL(/\/auth\/sign-in/)
    },
  }
}

export type DashboardShell = ReturnType<typeof dashboardShell>
