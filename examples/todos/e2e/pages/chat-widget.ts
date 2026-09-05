import { expect, type Locator, type Page } from "@playwright/test"

/**
 * The embedded chat widget.
 *
 * The widget lives in an open shadow root inside `aside.chat-sidebar`, so Playwright locators
 * reach into it while `body.innerText` does not: assert through locators, never page text.
 *
 * Selectors here track the SDK's own markup, all under `sdk/src/widget`:
 * `components/chat-composer.tsx` (the "Message" textbox, "Send", "Stop", "Attach files"),
 * `chat-widget.tsx` ("Reset conversation" and the header), `components/chat-transcript.tsx`
 * (`aria-busy` while a run streams, and the "Thinking…" status), `components/tool-disclosure.tsx`
 * (each tool call collapses to one trigger button), and `components/sandbox-panel.tsx` (the
 * "Sandbox · N files · M commands" trigger with Files and Log tabs). Update this file when that
 * markup changes; the specs should not need to.
 */
const CHAT_IDLE_TIMEOUT_MS = 150_000

/**
 * `/api/chat` allows 20 requests a minute per tenant user, and a single agent turn spans several
 * of them, because each host-tool call ends one request and starts another. A run of the agent
 * specs therefore exhausts that window, the endpoint answers 429, and the widget shows a
 * retryable error. Waiting the window out and pressing Retry keeps a throttled request from
 * failing an otherwise good spec. The example's token route mints one fixed tenant user, so every
 * spec shares the bucket; the limit itself is `CHAT_RATE_LIMIT_WINDOW_MS` and
 * `CHAT_RATE_LIMIT_MAX_REQUESTS` in `webapp/src/routes/api/chat/-lib/constants.server.ts`.
 */
const CHAT_RATE_LIMIT_COOLDOWN_MS = 65_000
const CHAT_RATE_LIMIT_MAX_RECOVERIES = 2
const CHAT_REPLY_POLL_MS = 250

export function chatWidget(page: Page) {
  const root = page.locator("aside.chat-sidebar")
  const composer = root.getByRole("textbox", { name: "Message" })
  const sendButton = root.getByRole("button", { name: "Send", exact: true })
  const stopButton = root.getByRole("button", { name: "Stop", exact: true })

  return {
    root,

    composer(): Locator {
      return composer
    },

    /** True once the widget has traded a session for a chat token and will accept a message. */
    async waitForReady(): Promise<void> {
      await expect(composer).toBeVisible()
      await expect(composer).not.toHaveAttribute("placeholder", "Verifying your session…")
      await expect(composer).toBeEnabled()
    },

    /** Sends a message and returns once the transcript shows it, so the run has begun. */
    async send(text: string): Promise<void> {
      await this.waitForReady()
      await composer.fill(text)
      await composer.press("Enter")
      await expect(root.getByText(text, { exact: false }).first()).toBeVisible()
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
      await expect(root.locator('[aria-busy="true"]')).toHaveCount(0, { timeout })
      await expect(root.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout })
      await expect(stopButton).toHaveCount(0, { timeout })
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
     * Waits for one more assistant turn than `previousCount`.
     *
     * A throttled request is waited out and retried; any other error banner fails immediately
     * with its own text, which beats spending the full timeout on a request that will never
     * succeed.
     */
    async waitForReply(previousCount: number): Promise<void> {
      let recoveries = 0
      let deadline = Date.now() + CHAT_IDLE_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (await this.assistantMessages().count() > previousCount) return
        const alert = this.errorAlert()
        if (await alert.count() > 0) {
          const message = await alert.first().innerText()
          if (!message.includes("429")) {
            throw new Error(`The chat request failed: ${message.replaceAll("\n", " ")}`)
          }
          if (recoveries >= CHAT_RATE_LIMIT_MAX_RECOVERIES) {
            throw new Error("The chat endpoint kept rate limiting this tenant user")
          }
          recoveries += 1
          await page.waitForTimeout(CHAT_RATE_LIMIT_COOLDOWN_MS)
          await alert.first().getByRole("button", { name: "Retry" }).click()
          deadline = Date.now() + CHAT_IDLE_TIMEOUT_MS
          continue
        }
        await page.waitForTimeout(CHAT_REPLY_POLL_MS)
      }
      throw new Error("The agent never added an assistant turn to the transcript")
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
    },

    /** The row a tool call collapses to, matched on its visible label. */
    toolRow(label: string | RegExp): Locator {
      return root.getByRole("button", { name: label })
    },

    async attach(filePath: string): Promise<void> {
      await root.locator('input[type="file"]').setInputFiles(filePath)
    },

    attachmentChip(name: string): Locator {
      return root.getByRole("button", { name: `Remove ${name}` })
    },

    resetButton(): Locator {
      return root.getByRole("button", { name: "Reset conversation" })
    },

    async reset(): Promise<void> {
      await this.resetButton().click()
    },

    emptyState(): Locator {
      // The widget's own empty transcript, from DEFAULT_EMPTY_TITLE in `sdk/src/lib/constants.ts`;
      // the host registers no `empty` slot.
      return root.getByText("Ask the assistant", { exact: false })
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
