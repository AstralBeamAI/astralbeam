import { expect, type Locator, type Page } from "@playwright/test"

/**
 * The host application's own UI.
 *
 * Selectors here track `src/components/todo-list.tsx`, `src/components/todo-card.tsx`, and the
 * control labels in `src/components/todos-page.tsx`. Update this file when that markup changes;
 * the specs should not need to.
 */
export function todosPage(page: Page) {
  const list = page.locator(".todos-list")

  const controls = {
    theme: page.getByRole("button", { name: /^Theme:/ }),
    customTheme: page.getByRole("button", { name: /^Custom theme:/ }),
    assistant: page.getByRole("button", { name: /assistant$/ }),
    debug: page.getByRole("button", { name: /^Debug:/ }),
  }

  return {
    async open(): Promise<void> {
      await page.goto("/")
      await expect(page.getByRole("heading", { name: "Todos" })).toBeVisible()
      await this.waitForHydration()
    },

    /**
     * The whole page is server-rendered, so its buttons are present and clickable before React
     * attaches their handlers, and a click that lands earlier is silently dropped. The chat
     * composer exists only once the browser has mounted the widget, which makes it a reliable
     * signal that hydration finished. It assumes the assistant is open, which it is on load.
     */
    async waitForHydration(): Promise<void> {
      await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 })
    },

    /** Every todo in the host list, in order. */
    items(): Locator {
      return list.locator("li")
    },

    item(text: string | RegExp): Locator {
      return list.locator("li").filter({ hasText: text })
    },

    checkbox(text: string | RegExp): Locator {
      return this.item(text).getByRole("checkbox")
    },

    async add(text: string): Promise<void> {
      await page.getByLabel("New todo").fill(text)
      await page.getByRole("button", { name: "Add", exact: true }).click()
      await expect(this.item(text)).toBeVisible()
    },

    /**
     * Todo cards the agent projected into the conversation. They render in the host's own React
     * tree as light-DOM children of the widget's shadow host, so they are ordinary page elements.
     */
    projectedCards(): Locator {
      return page.locator(".todo-card")
    },

    projectedCard(text: string | RegExp): Locator {
      return page.locator(".todo-card").filter({ hasText: text })
    },

    controls,

    /** The app writes its own dark class from the same preference it passes to the widget. */
    isDark(): Promise<boolean> {
      return page.locator(".app").evaluate((node) => node.classList.contains("dark"))
    },

    async cycleTheme(): Promise<void> {
      await controls.theme.click()
    },

    async toggleAssistant(): Promise<void> {
      await controls.assistant.click()
    },

    async toggleCustomTheme(): Promise<void> {
      await controls.customTheme.click()
    },

    /** The app carries the debug flag in the query string, so toggling it reloads the page. */
    async toggleDebug(): Promise<void> {
      const search = new URL(page.url()).search
      await controls.debug.click()
      await page.waitForURL((url) => url.search !== search)
      await this.waitForHydration()
    },
  }
}

export type TodosPage = ReturnType<typeof todosPage>
