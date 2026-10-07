import { expect, test } from "../../fixtures.ts"
import { todosPage } from "../../pages/todos-page.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { seedTarget } from "../../worktree.ts"
import { captureMoment } from "../../capture.ts"

test("chat history search, selection, and new chat preserve the correct local state", async ({
  page,
}) => {
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
  await page.route(/\/api\/v1\/chat\/threads\?/, (route) => {
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
        messages: [
          {
            id: "saved-input",
            role: "user",
            state: "complete",
            parts: [{ id: "text", type: "text", content: thread.title }],
          },
        ],
        pending_interactions: [],
        page_after: null,
        page_before: null,
      },
    })
  })
  await todosPage(page).open()
  await chatWidget(page).waitForReady()
  const picker = page.getByRole("combobox", { name: "Show older chats", exact: true })
  const search = page.getByRole("combobox", { name: "Search chats", exact: true })
  await picker.click()
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
              ? [
                  {
                    id: "context",
                    role: "user",
                    state: "complete",
                    parts: [{ id: "text", type: "text", content: "Earlier support context" }],
                  },
                ]
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
