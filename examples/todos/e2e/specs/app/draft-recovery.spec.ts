import { Buffer } from "node:buffer"
import { expect, test } from "../../fixtures.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { todosPage } from "../../pages/todos-page.ts"
import { seedTarget } from "../../worktree.ts"
import { captureMoment } from "../../capture.ts"

const thread = {
  id: "00000000-0000-4000-8000-000000000081",
  title: "Attachment draft",
  agent_id: seedTarget.agentId,
  version: 1,
  role: "manager",
  writer_active: false,
  current_leaf_message_id: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
}
const otherThread = {
  ...thread,
  id: "00000000-0000-4000-8000-000000000082",
  title: "Another draft",
}
const note = {
  name: "notes.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("Unsent file contents\n"),
}
const image = {
  name: "preview.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8r8AAAAASUVORK5CYII=",
    "base64",
  ),
}
const acceptedStream = [
  { type: "RUN_STARTED", threadId: thread.id, runId: "draft-test" },
  {
    type: "CUSTOM",
    name: "astralbeam_thread",
    value: { threadId: thread.id, version: 2, acceptedMessageId: "accepted" },
  },
  { type: "RUN_FINISHED", threadId: thread.id, runId: "draft-test" },
]
  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
  .join("")

test.beforeEach(async ({ context }) => {
  await context.route("**/api/v1/chat/threads", (route) => route.fulfill({ json: thread }))
  await context.route(/\/api\/v1\/chat\/threads\?/, (route) =>
    route.fulfill({ json: { items: [thread, otherThread], page_after: null, page_before: null } }),
  )
  await context.route("**/api/v1/chat/threads/*/messages?*", (route) =>
    route.fulfill({
      json: {
        thread: route.request().url().includes(otherThread.id) ? otherThread : thread,
        messages: [],
        pending_interactions: [],
        page_after: null,
        page_before: null,
      },
    }),
  )
})

test("reviewing a rejected file reveals and focuses its removal action", async ({ page }) => {
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  await chat.composer().fill("Keep this question and its valid file")
  const rejected = { ...note, name: "empty.txt", buffer: Buffer.alloc(0) }
  await chat.attach([rejected, note, image])
  await expect(chat.sendButton()).toBeEnabled()
  await expect(chat.errorAlert()).toContainText("The file is empty")
  await expect(chat.attachmentChip(rejected.name)).not.toBeInViewport()
  await chat.reviewFiles.press("Enter")
  await expect(chat.attachmentChip(rejected.name)).toBeFocused()
  await expect(chat.attachmentChip(rejected.name)).toBeInViewport()
  await captureMoment(page, "rejected-file-review-preserves-valid-attachments")
  await chat.attachmentChip(rejected.name).press("Enter")
  await expect(chat.reviewFiles).toHaveCount(0)
  await expect(chat.composer()).toHaveValue("Keep this question and its valid file")
  await expect(chat.attachmentChip(rejected.name)).toHaveCount(0)
})

test("acceptance removes submitted files and preserves files and text added during the request", async ({
  page,
}) => {
  let accept: (() => void) | undefined
  await page.route("**/api/v1/chat", async (route) => {
    await new Promise<void>((resolve) => {
      accept = resolve
    })
    await route.fulfill({ contentType: "text/event-stream", body: acceptedStream })
  })
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  await chat.attach(note)
  await expect(chat.sendButton()).toBeEnabled()
  await chat.sendButton().click()
  await expect.poll(() => accept !== undefined).toBe(true)
  await chat.composer().fill("My next message")
  await chat.attach(image)
  accept!()
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)
  await expect(chat.sendButton()).toBeEnabled()
  await page.reload()
  await expect(chat.composer()).toHaveValue("My next message")
  await expect(chat.attachmentChip(image.name)).toBeVisible()
})

test("stale tabs preserve newer files and cannot restore accepted files", async ({
  page,
  context,
}) => {
  await context.route("**/api/v1/chat", (route) =>
    route.fulfill({ contentType: "text/event-stream", body: acceptedStream }),
  )
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  const history = Promise.withResolvers<void>()
  await context.route(
    "**/api/v1/chat/threads/*/messages?*",
    (route) => history.promise.then(() => route.fallback()),
    { times: 1 },
  )
  await chat.selectConversation(thread.title)
  await expect(chat.composer()).toBeDisabled()
  await expect(chat.root.getByRole("button", { name: "Attach files", exact: true })).toBeDisabled()
  history.resolve()
  await chat.attach(note)
  await expect(chat.sendButton()).toBeEnabled()

  const otherPage = await context.newPage()
  await todosPage(otherPage).open()
  const otherChat = chatWidget(otherPage)
  await otherChat.waitForReady()
  await otherChat.selectConversation(thread.title)
  await expect(otherChat.attachmentChip(note.name)).toBeVisible()

  const later = { ...note, name: "later.txt" }
  await Promise.all([chat.attach(image), otherChat.attach(later)])
  await expect(chat.sendButton()).toBeEnabled()
  await expect(otherChat.sendButton()).toBeEnabled()
  await page.reload()
  for (const file of [note, image, later])
    await expect(chat.attachmentChip(file.name)).toBeVisible()
  await expect(chat.sendButton()).toBeEnabled()
  await chat.sendButton().click()
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)

  const next = { ...note, name: "next.txt" }
  await otherChat.attach(next)
  await expect(otherChat.sendButton()).toBeEnabled()
  await page.reload()
  await expect(chat.attachmentChip(next.name)).toBeVisible()
  for (const file of [note, image, later])
    await expect(chat.attachmentChip(file.name)).toHaveCount(0)
  await captureMoment(page, "stale-tab-keeps-only-unsent-files")
})

test("a failed send merges its draft into a preloaded destination without losing another tab's files", async ({
  page,
  context,
}) => {
  let submissions = 0
  await page.route("**/api/v1/chat", (route) => {
    submissions++
    return route.fulfill({ status: 503, json: { error: "Temporary failure" } })
  })
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  await chat.selectConversation(thread.title)
  await chat.waitForReady()
  await chat.reset()

  const otherPage = await context.newPage()
  await todosPage(otherPage).open()
  const otherChat = chatWidget(otherPage)
  await otherChat.waitForReady()
  await otherChat.selectConversation(thread.title)
  await otherChat.attach(image)
  await expect(otherChat.sendButton()).toBeEnabled()

  await chat.composer().fill("Keep my failed draft")
  await chat.attach(note)
  await expect(chat.sendButton()).toBeEnabled()
  await chat.sendButton().click()
  // The session keeps an uncertain send for Retry, and the reload below recovers its draft.
  await expect(chat.errorAlert().getByRole("button", { name: "Retry" })).toBeVisible()
  await expect(chat.composer()).toHaveValue("")
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)
  await page.reload()
  await expect(chat.attachmentChip(note.name)).toBeVisible()
  await expect(chat.attachmentChip(image.name)).toBeVisible()
  await expect(chat.composer()).toHaveValue("Keep my failed draft")
  expect(submissions).toBe(1)
})

test("independent new tabs recover their own drafts and cannot move or accept another tab's files", async ({
  page,
  context,
}) => {
  await context.route("**/api/v1/chat", (route) =>
    route.fulfill({ contentType: "text/event-stream", body: acceptedStream }),
  )
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  await chat.composer().fill("First tab draft")
  await chat.attach(note)
  await expect(chat.sendButton()).toBeEnabled()

  const otherPage = await context.newPage()
  await todosPage(otherPage).open()
  const otherChat = chatWidget(otherPage)
  await otherChat.waitForReady()
  await expect(otherChat.composer()).toHaveValue("")
  await expect(otherChat.attachmentChip(note.name)).toHaveCount(0)
  await otherChat.composer().fill("Second tab draft")
  await otherChat.attach(image)
  await expect(otherChat.sendButton()).toBeEnabled()

  await page.reload()
  await expect(chat.composer()).toHaveValue("First tab draft")
  await expect(chat.attachmentChip(note.name)).toBeVisible()
  await expect(chat.attachmentChip(image.name)).toHaveCount(0)
  await expect(chat.sendButton()).toBeEnabled()
  await chat.sendButton().click()
  await expect(chat.composer()).toHaveValue("")

  await otherPage.reload()
  await expect(otherChat.composer()).toHaveValue("Second tab draft")
  await expect(otherChat.attachmentChip(image.name)).toBeVisible()
  await expect(otherChat.attachmentChip(note.name)).toHaveCount(0)
  await captureMoment(otherPage, "independent-new-tab-draft-survives-another-tab-send")
})

test("draft files remain isolated between conversations and accounts", async ({ page }) => {
  let differentAccount = false
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as { user: { id: string } }
    await route.fulfill({
      json: differentAccount
        ? { ...body, user: { ...body.user, id: "00000000-0000-4000-8000-000000000099" } }
        : body,
    })
  })
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  await chat.selectConversation(thread.title)
  await chat.composer().fill("First conversation draft")
  await chat.attach(note)
  await expect(chat.sendButton()).toBeEnabled()
  await chat.selectConversation(otherThread.title)
  await expect(chat.composer()).toHaveValue("")
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)
  await chat.attach(image)
  await expect(chat.sendButton()).toBeEnabled()
  await page.reload()
  await expect(chat.attachmentChip(image.name)).toBeVisible()
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)

  differentAccount = true
  await page.reload()
  await chat.waitForReady()
  await expect(chat.composer()).toHaveValue("")
  await expect(chat.attachmentChip(image.name)).toHaveCount(0)
  differentAccount = false
  await page.reload()
  await chat.waitForReady()
  await chat.selectConversation(thread.title)
  await expect(chat.composer()).toHaveValue("First conversation draft")
  await expect(chat.attachmentChip(note.name)).toBeVisible()
  await expect(chat.attachmentChip(image.name)).toHaveCount(0)
  await chat.reset()
  await expect(chat.composer()).toHaveValue("")
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)
  await chat.selectConversation(thread.title)
  await expect(chat.composer()).toHaveValue("First conversation draft")
  await expect(chat.attachmentChip(note.name)).toBeVisible()
})

test("accepted uploads preview and download before reload and survive stream snapshots", async ({
  page,
}) => {
  const messageId = "00000000-0000-4000-8000-000000000083"
  const partId = "00000000-0000-4000-8000-000000000084"
  const fileId = "00000000-0000-4000-8000-000000000085"
  let failedDownload = true
  await page.route(`**/api/v1/chat/files?*fileId=${fileId}*`, (route) => {
    if (failedDownload && !route.request().headers()["x-file-preview"])
      return route.fulfill({ status: 503 })
    return route.fulfill({ contentType: image.mimeType, body: image.buffer })
  })
  const acceptedMessage = {
    id: messageId,
    role: "user",
    state: "complete",
    parent_message_id: null,
    author_tenant_user_id: null,
    source_assistant_message_id: null,
    source_tool_part_id: null,
    response_target_id: null,
    created_at: thread.created_at,
    parts: [
      {
        id: partId,
        type: "image",
        source: {
          type: "attachment",
          id: fileId,
          mimeType: image.mimeType,
          byteSize: image.buffer.length,
        },
        metadata: { filename: image.name },
      },
    ],
  }
  let accepted = false
  let releaseHistory: (() => void) | undefined
  await page.route("**/api/v1/chat/threads/*/messages?*", async (route) => {
    if (accepted)
      await new Promise<void>((resolve) => {
        releaseHistory = resolve
      })
    await route.fulfill({
      json: {
        thread,
        messages: accepted ? [acceptedMessage] : [],
        pending_interactions: [],
        page_after: null,
        page_before: null,
      },
    })
  })
  await page.route("**/api/v1/chat", (route) => {
    const body = route.request().postDataJSON() as {
      messages: Array<{ content: Array<Record<string, unknown>> }>
    }
    const input = body.messages[0]!
    accepted = true
    return route.fulfill({
      contentType: "text/event-stream",
      body: [
        { type: "RUN_STARTED", threadId: thread.id, runId: "preview-test" },
        {
          type: "CUSTOM",
          name: "astralbeam_thread",
          value: { threadId: thread.id, version: 2, acceptedMessageId: messageId, acceptedMessage },
        },
        {
          type: "MESSAGES_SNAPSHOT",
          threadId: thread.id,
          messages: [{ id: messageId, role: "user", parts: input.content }],
        },
        { type: "RUN_FINISHED", threadId: thread.id, runId: "preview-test" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    })
  })
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  await chat.attach(image)
  await expect(chat.sendButton()).toBeEnabled()
  await chat.sendButton().click()
  const preview = chat.root.locator('img[src^="blob:"]')
  await expect(preview).toBeVisible()
  await expect
    .poll(() => preview.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0)
  const downloadButton = chat.root.getByRole("button", { name: `Download ${image.name}` })
  await downloadButton.click()
  await expect(chat.root.getByText("File unavailable. Try again.")).toBeVisible()
  failedDownload = false
  const download = page.waitForEvent("download")
  await downloadButton.click()
  expect((await download).suggestedFilename()).toBe(image.name)
  await expect(chat.root.getByText("File unavailable. Try again.")).toHaveCount(0)
  await captureMoment(page, "accepted-upload-preview-and-download")
  await expect.poll(() => releaseHistory !== undefined).toBe(true)
  releaseHistory!()
})
