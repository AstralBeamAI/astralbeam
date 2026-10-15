import { expect, type Locator, type Page, test } from "@playwright/test"
import { fileURLToPath } from "node:url"
import { platformUrl, seedTarget } from "../worktree.ts"

/**
 * The embedded chat widget.
 *
 * The widget lives in an open shadow root inside `aside.chat-sidebar`, so Playwright locators
 * reach into it while `body.innerText` does not: assert through locators, never page text.
 *
 * Selectors here track the SDK's own markup, all under `sdk/src/widget`:
 * `components/chat-composer.tsx` (the "Message" textbox, "Send", "Stop", "Attach files"),
 * `chat-widget.tsx` ("New chat" and the header), `components/chat-transcript.tsx`
 * (`aria-busy` while a run streams, and the "Thinking…" status), `components/tool-disclosure.tsx`
 * (each tool call collapses to one trigger button), and `components/sandbox-panel.tsx` (the
 * "Sandbox · N files · M commands" trigger with Files and Log tabs). Update this file when that
 * markup changes; the specs should not need to.
 */
const CHAT_IDLE_TIMEOUT_MS = 150_000

/**
 * `/api/v1/chat` allows 20 new turns a minute per tenant user, with host-tool continuations in a
 * separate bucket of 200. A run of the agent specs can still exhaust a window, the endpoint
 * answers 429, and the widget shows a
 * retryable error. Waiting the window out and pressing Retry keeps a throttled request from
 * failing an otherwise good spec. The example's token route mints one fixed tenant user, so every
 * spec shares the buckets; the limits live beside `CHAT_RATE_LIMIT_MAX_REQUESTS` in
 * `platform/src/lib/chat/constants.ts`.
 */
const CHAT_RATE_LIMIT_COOLDOWN_MS = 65_000
const CHAT_RATE_LIMIT_MAX_RECOVERIES = 2
const CHAT_REPLY_POLL_MS = 250

export function chatWidget(page: Page) {
  const root = page.locator("aside.chat-sidebar")
  const composer = root.getByRole("textbox", { name: "Message" })
  const sendButton = root.getByRole("button", { name: "Send", exact: true })
  const stopButton = root.getByRole("button", { name: "Stop", exact: true })
  const busy = root
    .locator('[aria-busy="true"]')
    .or(root.getByRole("status", { name: "Loading" }))
    .or(stopButton)

  return {
    root,
    frame: root.locator('[data-slot="chat"]'),
    history: root.getByRole("combobox", { name: "Show older chats", exact: true }),
    historySearch: root.getByRole("combobox", { name: "Search chats", exact: true }),
    historyPopup: root.locator('[data-slot="combobox-content"]'),
    conversationActions: root.getByRole("button", { name: "Conversation actions", exact: true }),
    deleteConversation: root.getByRole("menuitem", { name: "Delete", exact: true }),
    deleteConfirmation: root.getByRole("alertdialog"),
    confirmDeletion: root.getByRole("button", { name: "Delete conversation", exact: true }),
    reviewFiles: root.getByRole("button", { name: "Review files", exact: true }),

    conversationOption(title: string): Locator {
      return root.getByRole("option", { name: title, exact: true })
    },

    async openNarrowHost(): Promise<void> {
      await page.route("**/__chat-sdk/*.js", (route) =>
        route.fulfill({
          path: fileURLToPath(
            new URL(
              `../../../../sdk/dist/${new URL(route.request().url()).pathname.split("/").pop()}`,
              import.meta.url,
            ),
          ),
          contentType: "text/javascript",
        }),
      )
      await page.route("**/*", (route) =>
        route.request().resourceType() === "script" ? route.abort() : route.continue(),
      )
      await page.goto("/")
      await page.unroute("**/*")
      await page.setContent(`<!doctype html><html lang="en"><title>Embedded chat</title>
        <aside class="chat-sidebar" style="width:320px;height:640px;margin:40px"></aside>
        <script type="module">
          import { mountAstralBeamChat } from '/__chat-sdk/client.js';
          mountAstralBeamChat(document.querySelector('aside'), {
            apiUrl: ${JSON.stringify(`${platformUrl}/api`)}, agentId: ${JSON.stringify(seedTarget.agentId)},
            showConversationTitle: true, fetchAstralBeamToken: { url: '/api/astralbeam/token' },
          });
        </script></html>`)
    },

    async expectWithinFrame(element: Locator): Promise<void> {
      await expect(element).toBeVisible()
      await expect
        .poll(async () => {
          const frame = (await this.frame.boundingBox())!
          const bounds = (await element.boundingBox())!
          return Math.max(
            frame.x - bounds.x,
            frame.y - bounds.y,
            bounds.x + bounds.width - frame.x - frame.width,
            bounds.y + bounds.height - frame.y - frame.height,
          )
        })
        .toBeLessThanOrEqual(0)
    },

    composer(): Locator {
      return composer
    },

    sendButton(): Locator {
      return sendButton
    },

    async composeWithIme(text: string): Promise<void> {
      await composer.fill(text)
      await composer.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true })
    },

    async selectConversation(title: string): Promise<void> {
      await root.getByRole("combobox", { name: "Show older chats", exact: true }).click()
      await page.getByRole("option", { name: title, exact: true }).click()
    },

    /** The composer's bottom row. Its middle is padding between the attach and send buttons. */
    composerButtonRow(): Locator {
      return root.locator('[data-slot="input-group-addon"][data-align="block-end"]')
    },

    /** True once the widget has traded a session for a chat auth token and will accept a message. */
    async waitForReady(): Promise<void> {
      await expect(composer).toBeVisible()
      await expect(composer).not.toHaveAttribute("placeholder", "Verifying your session…")
      await expect(composer).toBeEnabled()
    },

    /** Sends a message and returns once the transcript shows it, so the run has begun. */
    async send(text: string): Promise<void> {
      await test.step(`send "${text}"`, async () => {
        await this.waitForReady()
        await composer.fill(text)
        await composer.press("Enter")
        await expect(root.getByText(text, { exact: false }).first()).toBeVisible()
      })
    },

    /**
     * Waits for the run to finish, on three independent signals: the transcript is no longer
     * busy, no step is still spinning, and the composer offers Send rather than Stop.
     *
     * Do not wait on `role="status"` generally. The sandbox status pill uses it and stays for as
     * long as the conversation has a sandbox, so a blanket check never settles once one exists.
     * The spinner inside a running step is the one that carries the "Loading" name.
     */
    async waitForIdle(timeout = CHAT_IDLE_TIMEOUT_MS): Promise<void> {
      await expect(busy).toHaveCount(0, { timeout })
      await expect(sendButton).toBeVisible({ timeout })
    },

    /** Assistant turns in the transcript. The widget marks its own side of a message `start`. */
    assistantMessages(): Locator {
      return root.locator('[data-slot="message"][data-align="start"]')
    },

    /** The widget's retryable error banner, shown when a request fails. */
    errorAlert(): Locator {
      return root.getByRole("alert")
    },

    /**
     * Waits for a settled turn: more assistant turns than `previousCount` and an idle widget.
     *
     * Each host-tool round trip is its own request, so an error can land after the reply has
     * begun. A throttled request is waited out and retried, and any other error banner fails
     * immediately with its own text. Retry reruns the turn, so completion is rechecked each poll.
     */
    async waitForReply(previousCount: number): Promise<void> {
      await test.step("wait for the agent's reply", async () => {
        let recoveries = 0
        let deadline = Date.now() + CHAT_IDLE_TIMEOUT_MS
        while (Date.now() < deadline) {
          const replied = (await this.assistantMessages().count()) > previousCount
          const settled = replied && (await busy.count()) === 0
          const alert = this.errorAlert()
          if ((await alert.count()) > 0) {
            const message = await alert.first().innerText()
            if (!message.includes("429")) {
              throw new Error(`The chat request failed: ${message.replaceAll("\n", " ")}`)
            }
            if (recoveries >= CHAT_RATE_LIMIT_MAX_RECOVERIES) {
              throw new Error("The chat endpoint kept rate limiting this tenant user")
            }
            recoveries += 1
            await test.step(`rate limited (429), waiting out the ${CHAT_RATE_LIMIT_COOLDOWN_MS / 1000}s window`, () =>
              page.waitForTimeout(CHAT_RATE_LIMIT_COOLDOWN_MS))
            await alert.first().getByRole("button", { name: "Retry" }).click()
            deadline = Date.now() + CHAT_IDLE_TIMEOUT_MS
            continue
          }
          if (settled) return
          await page.waitForTimeout(CHAT_REPLY_POLL_MS)
        }
        throw new Error("The agent never finished a reply in the transcript")
      })
    },

    /**
     * Sends and waits for the agent to actually answer. Waiting for a new assistant turn before
     * quiescence matters: every idle signal is an absence, so a check that ran a moment too early
     * would pass against a run that had not started, and the spec after it would assert nothing.
     */
    async sendAndWait(text: string): Promise<void> {
      const before = await this.assistantMessages().count()
      await this.send(text)
      await this.waitForReply(before)
      await this.waitForIdle()
      await expect(this.errorAlert()).toHaveCount(0)
    },

    /** The row a tool call collapses to, matched on its visible label. */
    toolRow(label: string | RegExp): Locator {
      return root.getByRole("button", { name: label })
    },

    async attach(files: Parameters<Locator["setInputFiles"]>[0]): Promise<void> {
      await expect(root.getByRole("button", { name: "Attach files", exact: true })).toBeEnabled()
      await root.locator('input[type="file"]').setInputFiles(files)
    },

    attachmentChip(name: string): Locator {
      return root.getByRole("button", { name: `Remove ${name}` })
    },

    newChatButton(): Locator {
      return root.getByRole("button", { name: "New chat" })
    },

    async reset(): Promise<void> {
      await this.newChatButton().click()
    },

    emptyState(): Locator {
      return root.getByText("What would you like to get done?", { exact: true })
    },

    sandboxTrigger(): Locator {
      return root.getByRole("button", { name: /^Sandbox ·/ })
    },

    async openSandboxPanel(): Promise<void> {
      const trigger = this.sandboxTrigger()
      await expect(trigger).toBeVisible()
      if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click()
    },

    sandboxTab(name: "Files" | "Log"): Locator {
      return root.getByRole("tab", { name: new RegExp(`^${name}`) })
    },

    /** Download buttons in the Sandbox panel's Files tab, one per file the agent wrote. */
    sandboxFileDownloads(): Locator {
      return root.getByRole("button", { name: /^Download / })
    },
  }
}

export type ChatWidget = ReturnType<typeof chatWidget>
