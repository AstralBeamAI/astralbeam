import { expect, type Page } from "@playwright/test"

import { waitForHydration } from "../hydration.ts"

/** The dashboard's embedded Astro chat, from `routes/_authenticated/-components/dogfood-chat.tsx`. */
export function astroPanel(page: Page) {
  const panel = page.getByRole("dialog", { name: "Ask Astro" })
  const composer = panel.getByRole("textbox", { name: "Message" })

  return {
    panel,

    async open(): Promise<void> {
      const trigger = page.getByRole("button", { name: "Ask Astro" })
      await waitForHydration(trigger)
      await trigger.click()
      await expect(composer).toBeEnabled({ timeout: 30_000 })
    },

    /** Opens a saved conversation from the widget's history picker. */
    async openConversation(title: string): Promise<void> {
      await panel.getByRole("combobox", { name: "Show older chats" }).click()
      await panel.getByRole("option", { name: title }).click()
      await expect(panel.getByTitle(title, { exact: true })).toBeVisible()
    },
  }
}

export type AstroPanel = ReturnType<typeof astroPanel>
