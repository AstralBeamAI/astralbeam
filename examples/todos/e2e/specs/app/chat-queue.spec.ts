import { expect, test } from "../../fixtures.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { todosPage } from "../../pages/todos-page.ts"
import { seedTarget } from "../../worktree.ts"
import { captureMoment } from "../../capture.ts"

const id = "019a0700-0000-7000-8000-000000000001"
const turn = "019a0700-0000-7000-8000-000000000002"
interface QueueHarness {
  requests: string[]
  steering: string[]
  finish: () => void
}
type HarnessWindow = typeof globalThis & { queueHarness: QueueHarness }

test.beforeEach(async ({ page }) => {
  const thread = {
    id,
    title: "Queue example",
    agent_id: seedTarget.agentId,
    role: "manager",
    version: 1,
    writer_active: false,
    created_at: "2026-10-08T00:00:00Z",
    updated_at: "2026-10-08T00:00:00Z",
  }
  await page.route("**/api/v1/chat/threads", (route) => route.fulfill({ json: thread }))
  await page.route("**/api/v1/chat/threads/*/messages?*", (route) =>
    route.fulfill({
      json: { thread, messages: [], pending_interactions: [], page_after: null, page_before: null },
    }),
  )
  await page.addInitScript(
    ({ id, turn }) => {
      const original = globalThis.fetch.bind(globalThis)
      let controller: ReadableStreamDefaultController<Uint8Array>
      let runId: string
      const harness: QueueHarness = {
        requests: [],
        steering: [],
        finish: () => {
          emit({
            type: "CUSTOM",
            name: "astralbeam_thread",
            value: {
              threadId: id,
              turnMessageId: turn,
              turnState: "completed",
              version: 3,
              saved: true,
            },
          })
          emit({ type: "TEXT_MESSAGE_END", messageId: "answer" })
          emit({ type: "RUN_FINISHED", threadId: id, runId })
          controller.close()
        },
      }
      const emit = (event: object) =>
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
      ;(globalThis as HarnessWindow).queueHarness = harness
      globalThis.fetch = async (input, init) => {
        const path = new URL(
          typeof input === "string" || input instanceof URL ? input : input.url,
          location.href,
        ).pathname
        if (path.endsWith("/chat/threads/" + id + "/steer")) {
          harness.steering.push(init!.body as string)
          return Response.json({
            thread_id: id,
            accepted_message_id: "guidance",
            thread_version: 2,
          })
        }
        if (!path.endsWith("/api/v1/chat")) return original(input, init)
        const body = JSON.parse(init!.body as string) as { runId: string }
        harness.requests.push(init!.body as string)
        if (harness.requests.length > 1 || sessionStorage.getItem("queue-test-reloaded"))
          return Response.json({
            thread_id: id,
            accepted_message_id: "accepted-followup",
            thread_version: 4,
          })
        sessionStorage.setItem("queue-test-reloaded", "true")
        runId = body.runId
        return new Response(
          new ReadableStream<Uint8Array>({
            start(next) {
              controller = next
              emit({ type: "RUN_STARTED", threadId: id, runId })
              emit({
                type: "CUSTOM",
                name: "astralbeam_thread",
                value: {
                  threadId: id,
                  turnMessageId: turn,
                  turnState: "running",
                  acceptedMessageId: turn,
                  version: 2,
                },
              })
              emit({ type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" })
              emit({
                type: "TEXT_MESSAGE_CONTENT",
                messageId: "answer",
                delta: "Working on the first request",
              })
              init?.signal?.addEventListener(
                "abort",
                () => next.error(new DOMException("Stopped", "AbortError")),
                { once: true },
              )
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        )
      }
    },
    { id, turn },
  )
  await todosPage(page).open()
  await chatWidget(page).waitForReady()
})

test("busy composer queues, edits, steers, and sends FIFO after completion on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const widget = chatWidget(page)
  await widget.send("First request")
  await expect(widget.root.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
  await widget.composer().fill("Second request")
  await widget.composer().press("Enter")
  await expect(widget.composer()).toHaveValue("")
  await widget.composer().fill("Use blue")
  await widget.composer().press("Control+Enter")
  await expect(widget.root.getByText("Guidance received · Use blue")).toBeVisible()
  await widget.composer().fill("Third request")
  await widget.composer().press("Shift+Enter")
  await expect(widget.composer()).toHaveValue("Third request\n")
  await widget.composer().press("Enter")
  await captureMoment(page, "mobile-queue-and-steering")
  await widget.root.locator("summary").click()
  await widget.root.getByRole("button", { name: "Edit queued message" }).first().click()
  await widget.root.getByRole("textbox", { name: "Edit queued message" }).fill("Second edited")
  expect(
    await page.evaluate(() => (globalThis as HarnessWindow).queueHarness.requests.length),
  ).toBe(1)
  await page.evaluate(() => (globalThis as HarnessWindow).queueHarness.finish())
  await expect(widget.root.getByRole("button", { name: "Stop", exact: true })).not.toBeVisible()
  expect(
    await page.evaluate(() => (globalThis as HarnessWindow).queueHarness.requests.length),
  ).toBe(1)
  await widget.root.getByRole("button", { name: "Save", exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (globalThis as HarnessWindow).queueHarness.requests.length))
    .toBe(3)
  const requests = await page.evaluate(() => (globalThis as HarnessWindow).queueHarness.requests)
  expect(requests[1]).toContain("Second edited")
  expect(requests[2]).toContain("Third request")
  expect(
    await page.evaluate(() => (globalThis as HarnessWindow).queueHarness.steering),
  ).toHaveLength(1)
})

test("reload restores paused text and requires files before resume", async ({ page }) => {
  const widget = chatWidget(page)
  await widget.send("First request")
  await widget.composer().fill("Next text")
  await widget.composer().press("Enter")
  await widget.root
    .locator('input[type="file"]')
    .setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("Hello") })
  await widget.composer().fill("Read the note")
  await expect(widget.root.getByRole("button", { name: "Queue", exact: true })).toBeEnabled()
  await widget.composer().press("Enter")
  await expect(widget.composer()).toHaveValue("")
  await page.reload()
  await widget.waitForReady()
  await expect(
    widget.root.getByText("Queue paused. Review messages, then resume.", { exact: true }),
  ).toBeVisible()
  await expect(widget.root.getByRole("button", { name: "Reattach files" })).toBeVisible()
  expect(
    await page.evaluate(() => (globalThis as HarnessWindow).queueHarness.requests),
  ).toHaveLength(0)
  await widget.root.getByRole("button", { name: "Resume queue" }).click()
  await expect
    .poll(() => page.evaluate(() => (globalThis as HarnessWindow).queueHarness.requests.length))
    .toBe(1)
  await widget.root.getByRole("button", { name: "Reattach files" }).click()
  await expect(widget.root.getByRole("button", { name: "Resume queue" })).toBeDisabled()
  await widget.root
    .locator('input[type="file"]')
    .setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("Hello") })
  await widget.root.getByRole("button", { name: "Save attachments", exact: true }).click()
  await captureMoment(page, "reattached-queue")
  await widget.root.getByRole("button", { name: "Resume queue" }).click()
  await expect
    .poll(() => page.evaluate(() => (globalThis as HarnessWindow).queueHarness.requests.length))
    .toBe(2)
  await page.reload()
  await widget.waitForReady()
  await expect(widget.root.getByRole("button", { name: "Remove note.txt" })).toHaveCount(0)
  await expect(widget.root.getByRole("button", { name: "Reattach files" })).toHaveCount(0)
})
