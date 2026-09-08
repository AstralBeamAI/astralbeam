import { test as base } from "@playwright/test"

import { type AgentsPage, agentsPage } from "./pages/agents-page.ts"
import { type ApiKeysPage, apiKeysPage } from "./pages/api-keys-page.ts"
import { type AuthPage, authPage } from "./pages/auth-page.ts"
import { type ConfigurePage, configurePage } from "./pages/configure-page.ts"
import {
  type CreateOrganizationDialog,
  createOrganizationDialog,
} from "./pages/create-organization-dialog.ts"
import { type DashboardShell, dashboardShell } from "./pages/dashboard-shell.ts"
import { type MembersPage, membersPage } from "./pages/members-page.ts"
import { type OnboardingPage, onboardingPage } from "./pages/onboarding-page.ts"
import {
  type OrganizationSettingsPage,
  organizationSettingsPage,
} from "./pages/organization-settings-page.ts"
import { type SandboxesPage, sandboxesPage } from "./pages/sandboxes-page.ts"
import { type UserSettingsPage, userSettingsPage } from "./pages/user-settings-page.ts"

type Fixtures = {
  agents: AgentsPage
  apiKeys: ApiKeysPage
  auth: AuthPage
  configure: ConfigurePage
  members: MembersPage
  onboarding: OnboardingPage
  organizationDialog: CreateOrganizationDialog
  organizationSettings: OrganizationSettingsPage
  sandboxes: SandboxesPage
  shell: DashboardShell
  userSettings: UserSettingsPage
}

/**
 * The one import a spec needs. Every page object is a thin factory over `page`, so a spec composes
 * the flow it needs instead of repeating selectors.
 *
 * Playwright's second argument is positional, so it is named `provide` rather than `use`: Deno's
 * React lint rules read a bare `use(...)` call as React's own hook.
 */
export const test = base.extend<Fixtures>({
  agents: async ({ page }, provide) => await provide(agentsPage(page)),
  apiKeys: async ({ page }, provide) => await provide(apiKeysPage(page)),
  auth: async ({ page }, provide) => await provide(authPage(page)),
  configure: async ({ page }, provide) => await provide(configurePage(page)),
  members: async ({ page }, provide) => await provide(membersPage(page)),
  onboarding: async ({ page }, provide) => await provide(onboardingPage(page)),
  organizationDialog: async ({ page }, provide) => await provide(createOrganizationDialog(page)),
  organizationSettings: async ({ page }, provide) => await provide(organizationSettingsPage(page)),
  sandboxes: async ({ page }, provide) => await provide(sandboxesPage(page)),
  shell: async ({ page }, provide) => await provide(dashboardShell(page)),
  userSettings: async ({ page }, provide) => await provide(userSettingsPage(page)),
})

export { expect } from "@playwright/test"
