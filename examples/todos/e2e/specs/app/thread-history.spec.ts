import { expect, test } from "../../fixtures.ts"
import { todosPage } from "../../pages/todos-page.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { captureMoment } from "../../capture.ts"

test("conversation search, conflicting renames, and reset preserve the correct local state", async ({
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
  let renameAttempts = 0
  await page.route(`**/api/v1/chat/threads/${older.id}`, (route) => {
    if (renameAttempts++ === 0) {
      older.version++
      return route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        json: {
          title: "Conflict",
          status: 409,
          detail: "This conversation changed or is busy. Reload and try again",
        },
      })
    }
    const body = route.request().postDataJSON() as { expected_version: number; title: string }
    expect(body.expected_version).toBe(older.version)
    older.title = body.title
    older.version++
    return route.fulfill({ json: older })
  })
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
  const picker = page.getByRole("combobox", { name: "Conversations", exact: true })
  const search = page.getByRole("combobox", { name: "Search conversations…", exact: true })
  await picker.click()
  await page.getByRole("option", { name: recent.title, exact: true }).click()
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(recent.title)
  await picker.click()
  await expect(search).toBeFocused()
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
  await expect(page.getByText("No matches.", { exact: true })).toBeVisible()
  await search.press("Escape")
  await expect(picker).toBeFocused()
  await expect(picker).toContainText(older.title)
  const rename = page.getByRole("button", { name: "Rename conversation", exact: true })
  const title = page.getByRole("textbox", { name: "Conversation title", exact: true })
  const save = page.getByRole("button", { name: "Save", exact: true })
  await rename.click()
  await title.fill("Updated launch plan")
  await save.click()
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(title).toHaveValue("Updated launch plan")
  await captureMoment(page, "rename conflict preserves the attempted title")
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(title).toHaveValue("Updated launch plan")
  await save.click()
  await expect(title).toHaveCount(0)
  await expect(picker).toContainText("Updated launch plan")
  await captureMoment(page, "rename succeeds after refreshing the saved version")
  await rename.click()
  await page.getByRole("button", { name: "Reset conversation", exact: true }).click()
  await expect(title).toHaveCount(0)
  await captureMoment(page, "reset clears the previous conversation title editor")
  await picker.click()
  await expect(search).toHaveValue("")
  await expect(page.getByRole("option", { name: "New conversation", exact: true })).toHaveCount(0)
  await expect(page.getByRole("option", { name: recent.title, exact: true })).toBeVisible()
})
