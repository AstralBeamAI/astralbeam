import { expect, type Locator, type Page } from "@playwright/test"

import { openDialog } from "../dialogs.ts"

/**
 * `/:orgSlug/members`: the members table, the invite dialog, and the pending invitations table.
 * Tracks the Better Auth UI organization components under `src/components/auth/organization`.
 */
export function membersPage(page: Page) {
  const membersTable = page.getByRole("table", { name: /^members$/i })
  const invitationsTable = page.getByRole("table", { name: /^invitations$/i })

  return {
    membersTable,
    invitationsTable,

    memberRow(email: string): Locator {
      return membersTable.getByRole("row").filter({ hasText: email })
    },

    invitationRow(email: string): Locator {
      return invitationsTable.getByRole("row").filter({ hasText: email })
    },

    /** Better Auth creates the invitation and then sends its email, so this also proves delivery. */
    async invite(email: string): Promise<void> {
      await page.getByRole("button", { name: /^invite member$/i }).first().click()
      const dialog = openDialog(page)
      await dialog.locator("#invite-member-email").fill(email)
      await dialog.getByRole("button", { name: /^invite member$/i }).click()
      await expect(dialog).toBeHidden()
      await expect(this.invitationRow(email)).toBeVisible()
    },

    /** The row stays listed; only its status badge changes, which is how the history is kept. */
    async cancelInvitation(email: string): Promise<void> {
      await this.invitationRow(email).getByRole("button", { name: /cancel invitation/i }).click()
      await expect(this.invitationRow(email)).toContainText("Canceled")
    },
  }
}

export type MembersPage = ReturnType<typeof membersPage>
