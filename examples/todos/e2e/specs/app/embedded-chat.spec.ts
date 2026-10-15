import { expect, test, savedUserMessage } from "../../fixtures.ts"
import { captureMoment } from "../../capture.ts"
import { chatWidget } from "../../pages/chat-widget.ts"

test("a 320px host contains history and deletion controls without losing composer focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const thread = {
    id: "00000000-0000-4000-8000-000000000091",
    title: "Release planning with a long conversation title",
    agent_id: null,
    version: 1,
    role: "manager",
    writer_active: false,
    current_leaf_message_id: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  }
  let deleted = false
  await page.route(/\/api\/v1\/chat\/threads\?/, (route) =>
    route.fulfill({
      json: { items: deleted ? [] : [thread], page_after: null, page_before: null },
    }),
  )
  await page.route(`**/api/v1/chat/threads/${thread.id}/messages?*`, (route) =>
    route.fulfill({
      json: {
        thread,
        messages: [savedUserMessage("saved", "Plan the release")],
        pending_interactions: [],
        page_after: null,
        page_before: null,
      },
    }),
  )
  await page.route(`**/api/v1/chat/threads/${thread.id}?*`, (route) => {
    deleted = true
    return route.fulfill({ status: 204 })
  })
  const chat = chatWidget(page)
  await chat.openNarrowHost()
  await chat.waitForReady()
  await chat.history.press("Enter")
  await expect(chat.historySearch).toBeFocused()
  await expect(chat.conversationOption(thread.title)).toBeVisible()
  await chat.expectWithinFrame(chat.historyPopup)
  await expect(chat.frame).toHaveJSProperty("scrollLeft", 0)
  await captureMoment(page, "320px-embedded-history")
  await chat.conversationOption(thread.title).click()
  await expect(chat.frame).toHaveJSProperty("scrollLeft", 0)
  await chat.conversationActions.press("Enter")
  await chat.deleteConversation.press("Enter")
  await expect(chat.deleteConfirmation).toContainText(thread.title)
  await chat.expectWithinFrame(chat.deleteConfirmation)
  await chat.expectWithinFrame(chat.confirmDeletion)
  await captureMoment(page, "320px-embedded-delete-confirmation")
  await chat.confirmDeletion.press("Enter")
  await expect.poll(() => deleted).toBe(true)
  await expect(chat.deleteConfirmation).toHaveCount(0)
  await expect(chat.composer()).toBeFocused()
})
