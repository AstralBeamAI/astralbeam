import { expect, type Locator, type Page } from "@playwright/test"

import { expectToast } from "../dialogs.ts"

export type AgentDraft = {
  name: string
  systemPrompt: string
  attachmentsEnabled?: boolean
  models?: readonly string[]
}

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

    async fillForm({ name, systemPrompt, attachmentsEnabled, models }: AgentDraft): Promise<void> {
      await page.locator("#agent-name").fill(name)
      await page.locator("#agent-system-prompt").fill(systemPrompt)
      if (attachmentsEnabled !== undefined) {
        const toggle = page.getByRole("switch", { name: "File attachments", exact: true })
        await toggle.setChecked(attachmentsEnabled)
        await expect(toggle).toBeChecked({ checked: attachmentsEnabled })
      }
      if (models) {
        for (const checkbox of await page.getByRole("checkbox", { name: /./ }).all())
          await checkbox.uncheck()
      }
      for (const model of models ?? []) {
        await page.getByRole("checkbox", { name: model, exact: true }).check()
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

    async selectDefaultModel(label: string): Promise<void> {
      await page.getByRole("combobox", { name: "Default model", exact: true }).click()
      await page.getByRole("option", { name: label, exact: true }).click()
    },

    async setAsDefault(): Promise<void> {
      await page.getByRole("button", { name: "Agent actions" }).click()
      await page.getByRole("menuitem", { name: "Set as default" }).click()
      await expect(this.defaultBadge()).toBeVisible()
    },

    async deleteAgent(name: string): Promise<void> {
      await page.getByRole("button", { name: "Agent actions" }).click()
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click()
      await expect(page.getByRole("heading", { name: `Delete ${name}?` })).toBeVisible()
      await page.getByRole("button", { name: "Delete agent" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible()
    },
  }
}

export type AgentsPage = ReturnType<typeof agentsPage>
