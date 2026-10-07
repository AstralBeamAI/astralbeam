import { SEED_CONVERSATIONS, SEED_ORGANIZATIONS } from "../../../scripts/seed/fixtures.ts"
import { expect, test } from "../../fixtures.ts"

test("Astro reopens a seeded conversation from its history", async ({ page, astro }) => {
  const [conversation] = SEED_CONVERSATIONS.astro
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}`)
  await astro.open()
  await astro.openConversation(conversation.title)
  await expect(astro.panel.getByText(conversation.turns[0][0])).toBeVisible()
})
