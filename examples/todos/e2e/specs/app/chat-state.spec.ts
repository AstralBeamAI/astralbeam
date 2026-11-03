import { Buffer } from "node:buffer"
import type { Page } from "@playwright/test"
import { expect, test } from "../../fixtures.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { seedTarget } from "../../worktree.ts"

const REPLY = "First paragraph of the reply.\n\nSecond paragraph, so the reply outgrows the marker."
const savedThread = (id: string, title: string) => ({
  id,
  title,
  agent_id: seedTarget.agentId,
  version: 1,
  role: "manager",
  writer_active: false,
  current_leaf_message_id: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
})
const other = savedThread("00000000-0000-4000-8000-000000000091", "Another conversation")

/**
 * A stateful chat API: created threads keep their accepted turns, so the refresh after each reply
 * returns them as the platform would. `next` scripts the following chat request.
 */
async function stubChat(page: Page) {
  const threads = new Map([[other.id, { thread: other, messages: [] as object[] }]])
  const control = {
    sends: 0,
    next: "pass" as "pass" | "unavailable" | "rejected",
    replyDelay: 600,
    /** Holds the history read after the next reply until `release` is called. */
    holdRefresh: false,
    release: undefined as (() => void) | undefined,
  }
  let held = false
  await page.route("**/api/v1/chat/threads", (route) => {
    const id = `00000000-0000-4000-8000-${String(threads.size + 100).padStart(12, "0")}`
    threads.set(id, { thread: savedThread(id, ""), messages: [] })
    return route.fulfill({ json: threads.get(id)!.thread })
  })
  await page.route(/\/api\/v1\/chat\/threads\?/, (route) =>
    route.fulfill({
      json: {
        items: [...threads.values()].map(({ thread }) => thread).filter(({ title }) => title),
        page_after: null,
        page_before: null,
      },
    }),
  )
  await page.route("**/api/v1/chat/threads/*/messages?*", async (route) => {
    const saved = threads.get(new URL(route.request().url()).pathname.split("/").at(-2)!)!
    const response = { ...saved, pending_interactions: [], page_after: null, page_before: null }
    if (held) {
      held = false
      await new Promise<void>((resolve) => (control.release = resolve))
    }
    await route.fulfill({ json: response })
  })
  await page.route("**/api/v1/chat", async (route) => {
    control.sends++
    const mode = control.next
    control.next = "pass"
    if (mode === "unavailable") return route.fulfill({ status: 503, body: "Unavailable" })
    if (mode === "rejected")
      return route.fulfill({
        status: 400,
        json: { type: "about:blank", title: "Rejected", status: 400, detail: "Too long." },
      })
    const body = route.request().postDataJSON() as {
      threadId: string
      messages: Array<{
        content:
          | string
          | Array<{
              type: string
              text?: string
              source?: { value: string; mimeType: string }
              metadata?: { filename?: string; size?: number }
            }>
      }>
    }
    const content = body.messages.at(-1)!.content
    const text =
      typeof content === "string" ? content : (content.find((part) => part.text)?.text ?? "")
    const saved = threads.get(body.threadId)!
    const user = {
      id: `user-${control.sends}`,
      role: "user",
      state: "complete",
      parts:
        typeof content === "string"
          ? [{ id: "text", type: "text", content }]
          : content.map((part, index) =>
              part.type === "text"
                ? { id: `part-${index}`, type: "text", content: part.text ?? "" }
                : {
                    id: `part-${index}`,
                    type: part.type,
                    source: {
                      type: "attachment",
                      id: part.source?.value,
                      mimeType: part.source?.mimeType,
                      byteSize: part.metadata?.size,
                    },
                    metadata: part.metadata,
                  },
            ),
    }
    const reply = {
      id: `reply-${control.sends}`,
      role: "assistant",
      state: "complete",
      parts: [{ id: "text", type: "text", content: REPLY }],
    }
    saved.messages.push(user, reply)
    saved.thread = {
      ...saved.thread,
      title: saved.thread.title || text,
      version: control.sends + 1,
    }
    const thread = { threadId: body.threadId, version: saved.thread.version }
    const run = { threadId: body.threadId, runId: `run-${control.sends}` }
    const message = { messageId: reply.id }
    const events = [
      {
        type: "CUSTOM",
        name: "astralbeam_thread",
        value: { ...thread, acceptedMessageId: user.id, acceptedMessage: user, saved: false },
      },
      { type: "RUN_STARTED", ...run },
      { type: "TEXT_MESSAGE_START", ...message, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", ...message, delta: REPLY },
      { type: "TEXT_MESSAGE_END", ...message },
      { type: "RUN_FINISHED", ...run },
      { type: "CUSTOM", name: "astralbeam_thread", value: { ...thread, saved: true } },
    ]
    await new Promise((resolve) => setTimeout(resolve, control.replyDelay))
    held = control.holdRefresh
    control.holdRefresh = false
    await route.fulfill({
      contentType: "text/event-stream",
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    })
  })
  return control
}

type Frame = {
  loading: boolean
  draft: string
  chip: boolean
  bubbles: number
  thinking: number
  /** The Thinking marker's offset below the latest user bubble. */
  offset: number | undefined
  /** The height from the latest user bubble to the end of the last transcript item. */
  turn: number
}

/** Samples the widget on every animation frame until the returned function collects the frames. */
async function sampleFrames(page: Page, text: string, file = "") {
  await page.evaluate(
    ({ text, file }) => {
      const w = window as unknown as { frames_: Frame[]; sampling: boolean; run?: number }
      // A previous run's pending frame must not sample with its own text.
      const run = (w.run = (w.run ?? 0) + 1)
      w.frames_ = []
      w.sampling = true
      const root = document.querySelector("aside.chat-sidebar")!.shadowRoot!
      const tick = () => {
        if (w.run !== run) return
        const area = root.querySelector("textarea")
        const users = [...root.querySelectorAll('[data-slot="message"][data-align="end"]')]
        const last = users.at(-1)?.getBoundingClientRect()
        const markers = [...root.querySelectorAll('[role="status"]')].filter((element) =>
          element.textContent?.includes("Thinking…"),
        )
        const items = [...root.querySelectorAll('[data-slot="message-scroller-item"]')]
        const end = items.at(-1)?.getBoundingClientRect().bottom
        w.frames_.push({
          loading: !!root.textContent?.includes("Loading conversation") || !!area?.disabled,
          draft: area?.value ?? "",
          chip: !!file && !!area?.closest("form")?.textContent?.includes(file),
          bubbles: users.filter((user) => user.textContent?.includes(text)).length,
          thinking: markers.length,
          offset:
            last && markers[0]
              ? Math.round(markers[0].getBoundingClientRect().top - last.top)
              : undefined,
          turn: last && end ? Math.round(end - last.top) : 0,
        })
        if (w.sampling) requestAnimationFrame(tick)
      }
      tick()
    },
    { text, file },
  )
  return () =>
    page.evaluate(() => {
      const w = window as unknown as { frames_: Frame[]; sampling: boolean }
      w.sampling = false
      return w.frames_
    })
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
})

test("a send shows no loading, sent draft, extra marker, or shrinking turn in any frame", async ({
  page,
}) => {
  await stubChat(page)
  const chat = chatWidget(page)
  await chat.openNarrowHost()
  await chat.waitForReady()
  const note = { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Draft notes") }

  for (const [index, text] of ["First question", "Second question"].entries()) {
    const collect = await sampleFrames(page, text, note.name)
    if (index === 0) await chat.attach(note)
    await chat.composer().fill(text)
    await expect(chat.sendButton()).toBeEnabled()
    await chat.composer().press("Enter")
    await expect(chat.assistantMessages()).toHaveCount(index + 1)
    await chat.waitForIdle()
    await page.waitForTimeout(300)
    const frames = await collect()
    const turn = frames.slice(frames.findIndex((frame) => frame.bubbles > 0))
    expect(frames.filter((frame) => frame.loading)).toEqual([])
    expect(turn.filter((frame) => frame.draft === text || frame.chip)).toEqual([])
    expect(turn.filter((frame) => frame.bubbles !== 1)).toEqual([])
    expect(Math.max(...frames.map((frame) => frame.thinking))).toBe(1)
    expect(new Set(turn.flatMap((frame) => frame.offset ?? [])).size).toBe(1)
    expect(turn.filter((frame, i) => i > 0 && frame.turn < turn[i - 1]!.turn)).toEqual([])
  }

  const before = await chat.conversationActions.boundingBox()
  await chat.conversationActions.click()
  await expect(chat.root.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  expect(await chat.conversationActions.boundingBox()).toEqual(before)
})

test("a failed send keeps one Retry across navigation, and later drafts survive acceptance", async ({
  page,
}) => {
  const control = await stubChat(page)
  const chat = chatWidget(page)
  await chat.openNarrowHost()
  await chat.send("Titled conversation")
  await chat.waitForIdle()

  control.next = "unavailable"
  await chat.composer().fill("Keep this failed message")
  await chat.composer().press("Enter")
  const retry = chat.errorAlert().getByRole("button", { name: "Retry" })
  await expect(retry).toBeVisible()
  await expect(chat.composer()).toHaveValue("")
  await chat.selectConversation(other.title)
  await expect(chat.errorAlert()).toHaveCount(0)
  await chat.selectConversation("Titled conversation")
  await expect(retry).toBeVisible()
  await expect(chat.composer()).toHaveValue("")
  await retry.click()
  await chat.waitForIdle()
  await expect(
    chat.root.locator('[data-slot="message"]', { hasText: "Keep this failed message" }),
  ).toHaveCount(1)
  await expect(chat.composer()).toHaveValue("")
  await expect(chat.sendButton()).toBeDisabled()
  expect(control.sends).toBe(3)

  control.replyDelay = 1500
  await chat.composer().fill("Again")
  await chat.composer().press("Enter")
  await expect(chat.composer()).toHaveValue("")
  await chat.composer().fill("Again")
  await chat.waitForIdle()
  await expect(chat.composer()).toHaveValue("Again")
  await page.reload()
  await expect(chat.composer()).toHaveValue("Again")
})

for (const storage of ["available", "full"] as const) {
  test(`a refused send returns to the composer with ${storage} storage`, async ({ page }) => {
    const control = await stubChat(page)
    const chat = chatWidget(page)
    await chat.openNarrowHost()
    await chat.send("Titled conversation")
    await chat.waitForIdle()
    // Storage is only the reload backup, so recovery must not depend on writing it.
    if (storage === "full")
      await page.evaluate(() => {
        Storage.prototype.setItem = () => {
          throw new DOMException("Storage is full", "QuotaExceededError")
        }
      })
    await chat.attach({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Notes") })
    await chat.composer().fill("Rejected input")
    await expect(chat.sendButton()).toBeEnabled()
    control.next = "rejected"
    await chat.composer().press("Enter")
    await expect(chat.errorAlert()).toContainText("Too long.")
    await expect(chat.composer()).toHaveValue("Rejected input")
    await expect(chat.attachmentChip("notes.txt")).toBeVisible()
    await expect(chat.errorAlert().getByRole("button", { name: "Retry" })).toHaveCount(0)
    await expect(
      chat.root.locator('[data-slot="message"]', { hasText: "Rejected input" }),
    ).toHaveCount(0)
  })
}

test("Enter during history reconciliation preserves the draft until ready", async ({ page }) => {
  const control = await stubChat(page)
  const chat = chatWidget(page)
  await chat.openNarrowHost()
  control.holdRefresh = true
  await chat.send("First question")
  await expect.poll(() => control.release !== undefined).toBe(true)
  await chat.composer().fill("Sent during the refresh")
  await chat.composer().press("Enter")
  await expect(chat.composer()).toHaveValue("Sent during the refresh")
  expect(control.sends).toBe(1)
  control.release!()
  await chat.waitForIdle()
  await chat.composer().press("Enter")
  await expect(chat.composer()).toHaveValue("")
  await chat.waitForIdle()
  await expect(
    chat.root.locator('[data-slot="message"]', { hasText: "Sent during the refresh" }),
  ).toHaveCount(1)
  expect(control.sends).toBe(2)
})
