import { expect, test, savedUserMessage } from "../../fixtures.ts"
import { todosPage } from "../../pages/todos-page.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { seedTarget } from "../../worktree.ts"
import { captureMoment } from "../../capture.ts"

test("chat history refresh, search, selection, and new chat preserve local state", async ({
  page,
  context,
}) => {
  await page.clock.install()
  const recent = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Recent conversation",
    agent_id: null,
    version: 1,
    role: "manager",
    writer_active: false,
    current_leaf_message_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const older = {
    ...recent,
    id: "00000000-0000-4000-8000-000000000002",
    title: "Older launch plan",
  }
  let deleted = false
  let listRequests = 0
  await page.route(`**/api/v1/chat/threads/${recent.id}`, (route) => {
    if (route.request().method() !== "PATCH") return route.continue()
    recent.title = (route.request().postDataJSON() as { title: string }).title
    recent.version++
    return route.fulfill({ json: recent })
  })
  await page.route(`**/api/v1/chat/threads/${recent.id}?*`, (route) => {
    if (route.request().method() !== "DELETE") return route.continue()
    deleted = true
    return route.fulfill({ status: 204 })
  })
  await page.route(/\/api\/v1\/chat\/threads\?/, (route) => {
    listRequests++
    const params = new URL(route.request().url()).searchParams
    const q = params.get("q") ?? ""
    const cursor = params.get("page_after") ?? ""
    return route.fulfill({
      json: {
        items:
          q === "launch"
            ? cursor
              ? [older]
              : Array.from({ length: 20 }, (_, index) => ({
                  ...recent,
                  id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
                  title: `Launch plan ${index + 1}`,
                }))
            : q
              ? []
              : deleted
                ? []
                : [recent],
        page_after: q === "launch" && !cursor ? "launch-page-2" : null,
        page_before: null,
      },
    })
  })
  await page.route("**/api/v1/chat/threads/*/messages?*", (route) => {
    const thread = route.request().url().includes(older.id) ? older : recent
    return route.fulfill({
      json: {
        thread: thread,
        messages: [savedUserMessage("saved-input", thread.title)],
        pending_interactions: [],
        page_after: null,
        page_before: null,
      },
    })
  })
  const chat = chatWidget(page)
  await chat.openNarrowHost()
  await chat.waitForReady()
  const picker = chat.history
  const search = chat.historySearch
  await picker.click()
  await expect(chat.conversationOption(recent.title)).toBeVisible()
  await search.press("Escape")
  await picker.click()
  await expect(chat.conversationOption(recent.title)).toBeVisible()
  await expect(chat.historyPopup).not.toHaveAttribute("aria-busy", "true")
  expect(listRequests).toBe(1)
  await page.evaluate(() => globalThis.dispatchEvent(new Event("visibilitychange")))
  await context.setOffline(true)
  await context.setOffline(false)
  await page.clock.runFor(100)
  expect(listRequests).toBe(1)
  await page.clock.fastForward(31_000)
  recent.title = "Updated recent conversation"
  await page.evaluate(() => globalThis.dispatchEvent(new Event("visibilitychange")))
  await expect(chat.conversationOption(recent.title)).toBeVisible()
  expect(listRequests).toBe(2)
  await context.setOffline(true)
  await page.clock.fastForward(31_000)
  await context.setOffline(false)
  await expect.poll(() => listRequests).toBe(3)
  await expect(chat.historyPopup).not.toHaveAttribute("aria-busy", "true")
  await captureMoment(page, "history-refreshed-after-focus-and-reconnect")
  await page.getByRole("option", { name: recent.title, exact: true }).click()
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(recent.title)
  await picker.click()
  await expect(search).toBeFocused()
  await expect(page.getByRole("option", { name: recent.title, exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  )
  await search.fill("launch")
  await expect(page.getByRole("option", { name: "Launch plan 20", exact: true })).toBeAttached()
  const list = page.getByRole("listbox")
  await list.hover()
  await page.mouse.wheel(0, 1000)
  const match = page.getByRole("option", { name: older.title, exact: true })
  await expect(match).toBeVisible()
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(recent.title)
  await match.scrollIntoViewIfNeeded()
  await captureMoment(page, "conversation-server-search")
  await match.click()
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(older.title)
  await picker.click()
  await search.fill("no match")
  await expect(page.getByText("No chats found.", { exact: true })).toBeVisible()
  await search.press("Escape")
  await expect(picker).toBeFocused()
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  await picker.click()
  await expect(search).toHaveValue("")
  await expect(page.getByRole("option", { name: recent.title, exact: true })).toBeVisible()
  await expect(page.locator('[role="option"][aria-current="true"]')).toHaveCount(0)
  await chat.conversationOption(recent.title).click()
  await chat.conversationActions.click()
  await chat.renameConversation.click()
  await chat.conversationTitle.fill("Renamed conversation")
  await chat.conversationTitle.press("Enter")
  await expect(chat.conversationActions).toBeFocused()
  await picker.click()
  await expect(chat.conversationOption("Renamed conversation")).toBeVisible()
  const deleteButton = page.getByRole("button", { name: `Delete ${recent.title}`, exact: true })
  await page.getByRole("option", { name: recent.title, exact: true }).hover()
  await deleteButton.click()
  const confirmation = page.getByRole("alertdialog")
  await expect(confirmation).toContainText(recent.title)
  expect(deleted).toBe(false)
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(picker).toBeFocused()
  await picker.click()
  await page.getByRole("option", { name: recent.title, exact: true }).hover()
  await deleteButton.click()
  await confirmation.getByRole("button", { name: "Delete conversation", exact: true }).click()
  await expect.poll(() => deleted).toBe(true)
  await expect(confirmation).toHaveCount(0)
  await expect(picker).toBeFocused()
  await picker.click()
  await expect(page.getByText("No chats found.", { exact: true })).toBeVisible()
})

test("chat history denial removes cached titles before reopening and permits retry", async ({
  page,
}) => {
  const thread = {
    id: "00000000-0000-4000-8000-000000000004",
    title: "Private conversation",
    agent_id: null,
    version: 1,
    role: "manager",
    writer_active: false,
    current_leaf_message_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  let requests = 0
  let recovered = false
  const denied = Promise.withResolvers<void>()
  const recheck = Promise.withResolvers<void>()
  await page.route(/\/api\/v1\/chat\/threads\?/, async (route) => {
    requests++
    if (requests === 1 || recovered)
      return route.fulfill({
        json: { items: [thread], page_after: recovered ? null : "older", page_before: null },
      })
    await (requests === 2 ? denied.promise : recheck.promise)
    return route.fulfill({
      status: 403,
      json: { type: "about:blank", title: "Access denied", status: 403, detail: "Access denied" },
    })
  })
  const chat = chatWidget(page)
  await chat.openNarrowHost()
  await chat.waitForReady()
  await chat.history.click()
  await expect(chat.conversationOption(thread.title)).toBeVisible()
  await expect.poll(() => requests).toBe(2)
  denied.resolve()
  await expect(chat.historyPopup.getByRole("alert")).toBeVisible()
  await expect(chat.conversationOption(thread.title)).toHaveCount(0)
  await chat.historySearch.press("Escape")
  await chat.history.click()
  await expect.poll(() => requests).toBe(3)
  await expect(chat.conversationOption(thread.title)).toHaveCount(0)
  recheck.resolve()
  await expect(chat.historyPopup.getByRole("alert")).toBeVisible()
  recovered = true
  await chat.historyPopup.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(chat.conversationOption(thread.title)).toBeVisible()
})

for (const role of ["member", "manager", "viewer"]) {
  test(`${role} chats automatically page through empty projected history`, async ({ page }) => {
    const thread = {
      id: "00000000-0000-4000-8000-000000000003",
      title: "Saved history",
      agent_id: seedTarget.agentId,
      version: 1,
      role,
      writer_active: false,
      current_leaf_message_id: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-06T00:00:00Z",
    }
    let earlierRequests = 0
    await page.route(/\/api\/v1\/chat\/threads\?/, (route) =>
      route.fulfill({ json: { items: [thread], page_after: null, page_before: null } }),
    )
    await page.route("**/api/v1/chat/threads/*/messages?*", (route) => {
      const earlier = new URL(route.request().url()).searchParams.has("page_after")
      if (earlier) earlierRequests++
      return route.fulfill({
        json: {
          thread,
          messages:
            earlierRequests === 2
              ? [savedUserMessage("context", "Earlier support context")]
              : [
                  {
                    id: `result-${earlierRequests}`,
                    role: "tool",
                    state: "complete",
                    source_assistant_message_id: "assistant",
                    source_tool_part_id: "call",
                    response_target_id: "target",
                    parts: [
                      {
                        id: "result",
                        type: "tool-result",
                        output: { ok: true },
                        outcome: "succeeded",
                      },
                    ],
                  },
                ],
          pending_interactions: [],
          page_after: earlierRequests === 2 ? null : `earlier-${earlierRequests}`,
          page_before: null,
        },
      })
    })
    await todosPage(page).open()
    await chatWidget(page).waitForReady()
    await page.getByRole("combobox", { name: "Show older chats", exact: true }).click()
    await page.getByRole("option", { name: thread.title, exact: true }).click()
    await expect(page.getByRole("region", { name: "Messages" })).toContainText(
      "Earlier support context",
    )
    const composer = page.getByRole("textbox", { name: "Message", exact: true })
    await composer.fill("Unsaved text")
    const send = page.getByRole("button", { name: "Send", exact: true })
    if (role === "viewer") await expect(send).toBeDisabled()
    else await expect(send).toBeEnabled()
    expect(earlierRequests).toBe(2)
    await captureMoment(page, `${role}-automatically-loaded-history`)
  })
}
