import { test as base } from "@playwright/test"

import { type ChatWidget, chatWidget } from "./pages/chat-widget.ts"
import { type TodosPage, todosPage } from "./pages/todos-page.ts"

/**
 * The one import a spec needs. `todos` and `chat` arrive with the page open and hydrated, so a
 * spec starts at the interaction it is about. Add a fixture here when several specs need the same
 * setup; keep one-off setup in the spec, and read fixed values such as URLs and seeded identities
 * straight from `worktree.ts`.
 *
 * Playwright's second argument is positional, so it is named `provide` rather than `use`: Deno's
 * React lint rules read a bare `use(...)` call as React's own hook.
 */
export const test = base.extend<{ todos: TodosPage; chat: ChatWidget }>({
  todos: async ({ page }, provide) => {
    const todos = todosPage(page)
    await todos.open()
    await provide(todos)
  },
  chat: async ({ page, todos }, provide) => {
    // Depends on `todos` so the page is open and the widget has begun its token request.
    void todos
    await provide(chatWidget(page))
  },
})

export { expect } from "@playwright/test"
