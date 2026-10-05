import { expect, test } from "../../fixtures.ts"
import { todosPage } from "../../pages/todos-page.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { captureMoment } from "../../capture.ts"

test("conversation search finds unloaded titles and preserves history while typing", async ({
  page,
}) => {
  const queries: string[] = []
  const cursors: string[] = []
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
    queries.push(q)
    cursors.push(cursor)
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
  await page.route("**/api/v1/chat/threads/*/participants?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            tenant_user_id: recent.id,
            name: "Sam",
            external_id: "sam",
            email: null,
            role: "manager",
          },
        ],
        page_after: null,
        page_before: null,
      },
    }),
  )
  await todosPage(page).open()
  await chatWidget(page).waitForReady()
  const picker = page.getByRole("combobox", { name: "Conversations", exact: true })
  const search = page.getByRole("combobox", { name: "Search conversations…", exact: true })
  await expect(page.getByRole("button", { name: "Refresh history" })).toHaveCount(0)
  await picker.click()
  await page.getByRole("option", { name: recent.title, exact: true }).click()
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(recent.title)
  await picker.click()
  await expect(search).toBeFocused()
  await search.fill("launch")
  await expect(page.getByRole("option", { name: "Launch plan 20", exact: true })).toBeAttached()
  await page.getByRole("listbox").evaluate((list) => {
    list.scrollTop = list.scrollHeight
  })
  const match = page.getByRole("option", { name: older.title, exact: true })
  await expect(match).toBeVisible()
  expect(queries).toContain("launch")
  expect(cursors).toContain("launch-page-2")
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(recent.title)
  await match.scrollIntoViewIfNeeded()
  await captureMoment(page, "conversation-server-search")
  await match.click()
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(older.title)
  await picker.click()
  await search.fill("no match")
  await expect(page.getByText("No matches.", { exact: true })).toBeVisible()
  await search.press("Escape")
  await expect(picker).toBeFocused()
  await expect(picker).toContainText(older.title)
  await page.getByRole("button", { name: "Manage conversation access", exact: true }).click()
  const managerRole = page.getByRole("combobox", { name: "Role for Sam", exact: true })
  await managerRole.click()
  await managerRole.fill("viewer")
  await managerRole.press("ArrowDown")
  await expect(page.getByRole("option", { name: "Viewer", exact: true })).toBeDisabled()
  await captureMoment(page, "searchable-role-last-manager")
  await managerRole.press("Escape")
  await page.getByRole("button", { name: "New conversation", exact: true }).click()
  await picker.click()
  await expect(search).toHaveValue("")
  await expect(page.getByRole("option", { name: "New conversation", exact: true })).toHaveCount(0)
  await expect(page.getByRole("option", { name: recent.title, exact: true })).toBeVisible()
})
