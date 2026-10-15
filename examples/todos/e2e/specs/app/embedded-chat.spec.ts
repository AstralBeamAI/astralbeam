import { expect, test, savedUserMessage } from "../../fixtures.ts"
import { captureMoment } from "../../capture.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { openBrowserFixture } from "../../pages/fixture-page.ts"

test("a 320px host keeps custom slots, chat history, and confirmations usable by keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  let thread = {
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
  await page.route(new RegExp(`/api/v1/chat/threads/${thread.id}(?:\\?|$)`), (route) => {
    if (route.request().method() === "DELETE") {
      deleted = true
      return route.fulfill({ status: 204 })
    }
    const body = route.request().postDataJSON() as { title: string }
    thread = { ...thread, title: body.title, version: thread.version + 1 }
    return route.fulfill({ json: thread })
  })
  await openBrowserFixture(page, new URL("../../fixtures/chat-slots.tsx", import.meta.url))
  const chat = chatWidget(page)
  await chat.waitForReady()
  expect((await chat.frame.boundingBox())!.width).toBe(320)
  await expect(chat.hostHeader).toBeVisible()
  await chat.hostHelp.press("Enter")
  await chat.hostContext.press("Enter")
  await expect(chat.hostActionCount).toHaveText("Host actions: 2")
  await chat.expectWithinFrame(chat.composer())
  await chat.history.press("Enter")
  await expect(chat.historySearch).toBeFocused()
  await expect(chat.conversationOption(thread.title)).toBeVisible()
  await chat.expectWithinFrame(chat.historyPopup)
  expect(
    await chat.historyPopup.evaluate((element) =>
      parseFloat(getComputedStyle(element).animationDuration),
    ),
  ).toBeLessThanOrEqual(0.001)
  await captureMoment(page, "320px-embedded-history-and-host-slots")
  await chat.historySearch.press("Escape")
  await expect(chat.history).toBeFocused()
  await chat.history.press("Enter")
  await expect(chat.conversationOption(thread.title)).toBeVisible()
  await chat.historySearch.press("ArrowDown")
  await chat.historySearch.press("Enter")
  await expect(chat.composer()).toBeFocused()

  await chat.conversationActions.press("Enter")
  await chat.conversationAction("Rename").press("Enter")
  await expect(chat.conversationTitle).toBeFocused()
  await chat.conversationTitle.fill("Renamed release plan")
  await chat.conversationTitle.press("Enter")
  await expect(chat.conversationActions).toBeFocused()
  expect(thread.title).toBe("Renamed release plan")
  await chat.conversationActions.press("Enter")
  await chat.conversationAction("Delete").press("Enter")
  await expect(chat.deleteConfirmation).toContainText(thread.title)
  await chat.expectWithinFrame(chat.deleteConfirmation)
  await chat.expectWithinFrame(chat.confirmDeletion())
  await captureMoment(page, "320px-embedded-delete-confirmation")
  await chat.confirmDeletion().press("Enter")
  await expect.poll(() => deleted).toBe(true)
  await expect(chat.deleteConfirmation).toHaveCount(0)
  await expect(chat.composer()).toBeFocused()
  await expect(chat.hostActionCount).toHaveText("Host actions: 2")
})
