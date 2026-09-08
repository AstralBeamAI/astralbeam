import { expect, type Locator, type Page } from "@playwright/test"

import { expectToast } from "../dialogs.ts"

export type AgentDraft = { name: string; systemPrompt: string; attachmentsEnabled?: boolean }

/**
 * The agents list, the shared create/edit form, and the agent detail actions under
 * `src/routes/_authenticated/$orgSlug/agents`.
 */
export function agentsPage(page: Page) {
  return {
    card(name: string | RegExp): Locator {
      return page.locator('[data-slot="card"]').filter({ hasText: name })
    },

    cards(): Locator {
      return page.locator('[data-slot="card"]').filter({ has: page.getByText("Agent ID") })
    },

    /** The read-only public identifier on the detail page, in `agent_<org>_<agent>` form. */
    publicId(): Locator {
      return page.locator("#agent-public-id")
    },

    defaultBadge(): Locator {
      return page.getByText("Default", { exact: true })
    },

    async openAgent(name: string | RegExp): Promise<void> {
      await this.card(name).getByRole("link").click()
      await expect(this.publicId()).toBeVisible()
    },

    async startCreate(): Promise<void> {
      await page.getByRole("link", { name: "Add agent" }).first().click()
      await expect(page.getByRole("heading", { level: 1, name: "Add agent" })).toBeVisible()
    },

    async fillForm({ name, systemPrompt, attachmentsEnabled }: AgentDraft): Promise<void> {
      await page.locator("#agent-name").fill(name)
      await page.locator("#agent-system-prompt").fill(systemPrompt)
      if (attachmentsEnabled !== undefined) {
        // The shadcn checkbox keeps its id on a hidden proxy input, so drive it through its role.
        const checkbox = page.locator("form").getByRole("checkbox")
        if (await checkbox.isChecked() !== attachmentsEnabled) await checkbox.click()
        await expect(checkbox).toBeChecked({ checked: attachmentsEnabled })
      }
    },

    /** Creating navigates to the new agent's detail page, where its assigned ID is shown. */
    async submitCreate(): Promise<void> {
      await page.getByRole("button", { name: "Create agent" }).click()
      await expect(this.publicId()).toBeVisible()
    },

    /** Waits for the write itself, because the button is enabled again either way. */
    async saveChanges(): Promise<void> {
      await page.getByRole("button", { name: "Save changes" }).click()
      await expectToast(page, "Agent saved")
    },

    async setAsDefault(): Promise<void> {
      await page.getByRole("button", { name: "Set as default" }).click()
      await expect(page.getByRole("button", { name: "Set as default" })).toBeHidden()
    },

    async deleteAgent(name: string): Promise<void> {
      await page.getByRole("button", { name: `Delete ${name}` }).click()
      await page.getByRole("button", { name: "Delete agent" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible()
    },
  }
}

export type AgentsPage = ReturnType<typeof agentsPage>
