import { expect, type Page } from "@playwright/test"
import { chatWidget } from "./chat-widget.ts"

export function chatSizing(page: Page) {
  const chat = chatWidget(page)
  const handle = chat.root.getByRole("separator", { name: "Resize chat", exact: true })
  return {
    handle,
    fillWidth: page.getByRole("checkbox", { name: "Use full available width" }),
    resizable: page.getByRole("checkbox", { name: "Allow resizing" }),
    showContainer: page.getByRole("button", { name: "Show container" }),
    changeDefault: page.getByRole("button", { name: "Change initial width" }),

    async openHost({
      hidden = false,
      collapsed = false,
      agentId = "",
      hostId = "chat-sizing-test",
    }: {
      hidden?: boolean
      collapsed?: boolean
      agentId?: string
      hostId?: string
    } = {}): Promise<void> {
      const fixture = new URL("../fixtures/chat-sizing.ts", import.meta.url)
      const fixturePath = fixture.pathname.slice(new URL("../../", import.meta.url).pathname.length)
      await page.route("**/*", (route) =>
        route.request().resourceType() === "script" ? route.abort() : route.continue(),
      )
      await page.goto("/")
      await page.unroute("**/*")
      await page.setContent(`<!doctype html><html lang="en"><title>Chat sizing</title>
            <label><input id="fill-width" type="checkbox">Use full available width</label>
            <label><input id="resizing" type="checkbox" checked>Allow resizing</label>
            <button id="default-width" type="button">Change initial width</button>
            <button id="show" type="button" ${hidden || collapsed ? "" : "hidden"}>Show container</button>
            <main style="display:flex;justify-content:flex-end;width:960px;height:640px">
              <div style="display:${hidden ? "none" : "contents"}"><aside class="chat-sidebar" id="${hostId}" data-agent-id="${agentId}" data-initial-width="${hidden || collapsed ? "" : "480"}" style="width:${hidden ? 400 : 0}px;height:100%"></aside></div>
            </main><script type="module" src="/${fixturePath}"></script></html>`)
      if (hidden || collapsed) await expect(chat.frame).toBeAttached()
      else await chat.waitForReady()
    },

    async expectWidth(pixels: number): Promise<void> {
      await expect.poll(async () => Math.round((await chat.root.boundingBox())!.width)).toBe(pixels)
    },

    async setWidth(pixels: number): Promise<void> {
      const current = (await chat.root.boundingBox())!.width
      await this.dragBy(pixels - current)
      await this.expectWidth(pixels)
    },

    async dragBy(pixels: number, cancel = false): Promise<void> {
      const bounds = (await handle.boundingBox())!
      const x = bounds.x + bounds.width / 2
      const y = bounds.y + bounds.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x - pixels, y, { steps: 8 })
      if (cancel) await page.keyboard.press("Escape")
      await page.mouse.up()
    },

    async setBoundaryWidth(pixels: number): Promise<void> {
      await page.locator("main").evaluate((element, value) => {
        element.style.width = `${value}px`
      }, pixels)
    },
  }
}
