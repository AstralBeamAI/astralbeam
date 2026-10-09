import { Buffer } from "node:buffer"
// @deno-types="../../../../../sdk/dist/server.d.ts"
import { createAstralBeamToken } from "../../../../../sdk/dist/server.js"
import { expect, test } from "../../fixtures.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { todosPage } from "../../pages/todos-page.ts"
import { seedTarget, platformUrl } from "../../worktree.ts"
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
  // Fixtures have separate budgets and directory identities. Preflight checks the host token route.
  const id = `upload-draft-${crypto.randomUUID()}`
  const user = { ...seedTarget.user, id, name: id, admin: false, metadata: {} }
  await context.route("**/api/astralbeam/token", async (route) =>
    route.fulfill({
      json: {
        token: await createAstralBeamToken({
          apiKey: seedTarget.apiKey,
          user,
          tenant: seedTarget.tenant,
        }),
      },
    }),
  )
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

test("unsent text, images, and large files recover, and accepted files stay cleared", async ({
  page,
}) => {
  let releaseCapabilities = () => {}
  const capabilitiesReady = new Promise<void>((resolve) => {
    releaseCapabilities = resolve
  })
  let capabilitiesRequested = false
  await page.route("**/api/v1/chat/config?*", async (route) => {
    capabilitiesRequested = true
    await capabilitiesReady
    await route.continue()
  })
  const large = {
    name: "large.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(6 * 1024 * 1024, "a"),
  }
  let submissions = 0
  await page.route("**/api/v1/chat", async (route) => {
    submissions++
    const body = route.request().postDataJSON() as {
      messages: Array<{
        role: string
        content: Array<{
          source?: { type: string; provider: string; value: string }
          metadata?: { filename: string }
        }>
      }>
    }
    const parts = body.messages.find((message) => message.role === "user")!.content
    for (const file of [large, image])
      expect(parts.find((part) => part.metadata?.filename === file.name)?.source).toMatchObject({
        type: "file",
        provider: "astralbeam",
        value: expect.stringMatching(/^[0-9a-f-]{36}$/),
      })
    expect(parts.some((part) => part.metadata?.filename === note.name)).toBe(false)
    await route.fulfill({ contentType: "text/event-stream", body: acceptedStream })
  })
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  await expect.poll(() => capabilitiesRequested).toBe(true)
  await expect(chat.root.getByRole("button", { name: "Attach files", exact: true })).toHaveCount(0)
  releaseCapabilities()
  await chat.composer().fill("  Keep my unsent question\nwith these files  ")
  await chat.attach([note, image, large])
  await expect(chat.sendButton()).toBeEnabled()
  const saved = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open("astralbeam:drafts", 2)
        open.onsuccess = () => {
          const database = open.result
          const read = database.transaction("attachments").objectStore("attachments").getAll()
          read.onsuccess = () => {
            resolve(read.result as unknown[])
            database.close()
          }
          read.onerror = () => reject(read.error ?? new Error("Draft read failed"))
        }
        open.onerror = () => reject(open.error ?? new Error("Draft database open failed"))
      }),
  )
  expect(saved.flat()).toHaveLength(3)
  for (const file of saved.flat() as Record<string, unknown>[]) {
    expect(file).toHaveProperty("sessionId")
    expect(file).toHaveProperty("sha256")
    expect(file).not.toHaveProperty("data")
    expect(file).not.toHaveProperty("preview")
    expect(JSON.stringify(file)).not.toContain("http")
  }
  await page.reload()
  await expect(chat.composer()).toHaveValue("  Keep my unsent question\nwith these files  ")
  for (const file of [note, image, large])
    await expect(chat.attachmentChip(file.name)).toBeVisible()
  expect(submissions).toBe(0)
  await captureMoment(page, "text-image-and-large-file-recovered")

  const later = { ...note, name: "later.txt" }
  await chat.attach(later)
  await chat.attachmentChip(note.name).click()
  await expect(chat.sendButton()).toBeEnabled()
  await page.reload()
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)
  for (const file of [image, large, later])
    await expect(chat.attachmentChip(file.name)).toBeVisible()
  await expect(chat.sendButton()).toBeEnabled()
  await chat.sendButton().click()
  await expect(chat.composer()).toHaveValue("")
  await page.reload()
  await chat.waitForReady()
  await expect(chat.composer()).toHaveValue("")
  for (const file of [image, large, later])
    await expect(chat.attachmentChip(file.name)).toHaveCount(0)
  expect(submissions).toBe(1)
})

test("completed images remain sendable when their restored preview is unavailable", async ({
  page,
}) => {
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  await chat.attach(image)
  await expect(chat.sendButton()).toBeEnabled()
  await page.route(/\/api\/v1\/chat\/files\//, (route) => route.fulfill({ status: 503 }))
  await page.reload()
  await expect(chat.attachmentChip(image.name)).toBeVisible()
  await expect(chat.sendButton()).toBeEnabled()
  let submittedFile: unknown
  await page.route("**/api/v1/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      messages: Array<{ role: string; content: Array<{ source?: unknown }> }>
    }
    submittedFile = body.messages.find((message) => message.role === "user")?.content[0]?.source
    await route.fulfill({ contentType: "text/event-stream", body: acceptedStream })
  })
  await chat.sendButton().click()
  await expect.poll(() => submittedFile).toMatchObject({ type: "file", provider: "astralbeam" })
  await expect(chat.attachmentChip(image.name)).toHaveCount(0)
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
  await chat.selectConversation(thread.title)
  await chat.attach(note)
  await expect(chat.sendButton()).toBeEnabled()

  const otherPage = await context.newPage()
  await todosPage(otherPage).open()
  const otherChat = chatWidget(otherPage)
  await otherChat.waitForReady()
  await otherChat.selectConversation(thread.title)
  await expect(otherChat.attachmentChip(note.name)).toBeVisible()

  await chat.attach(image)
  await expect(chat.sendButton()).toBeEnabled()
  const later = { ...note, name: "later.txt" }
  await otherChat.attach(later)
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
  await expect(chat.errorAlert()).toBeVisible()
  await expect(chat.composer()).toHaveValue("Keep my failed draft")
  await expect(chat.attachmentChip(note.name)).toBeVisible()
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

for (const failure of ["disabled", "quota"] as const) {
  test(`${failure} browser storage does not prevent attaching or sending`, async ({ page }) => {
    await page.addInitScript((mode) => {
      if (mode === "disabled") {
        Object.defineProperty(window, "indexedDB", {
          get: () => {
            throw new DOMException("Disabled", "SecurityError")
          },
        })
      } else {
        IDBObjectStore.prototype.put = () => {
          throw new DOMException("Full", "QuotaExceededError")
        }
      }
    }, failure)
    await page.route("**/api/v1/chat", (route) =>
      route.fulfill({ contentType: "text/event-stream", body: acceptedStream }),
    )
    await todosPage(page).open()
    const chat = chatWidget(page)
    await chat.waitForReady()
    await chat.composer().fill("Still usable")
    await chat.attach(note)
    await expect(chat.sendButton()).toBeEnabled()
    await expect(
      page.getByText(
        "Files cannot be recovered after reload because browser storage is unavailable.",
      ),
    ).toBeVisible()
    await chat.sendButton().click()
    await expect(chat.composer()).toHaveValue("")
    await expect(chat.attachmentChip(note.name)).toHaveCount(0)
  })
}

test("submitted files stay pinned while admission waits and acceptance clears them", async ({
  page,
}) => {
  let accept!: () => void
  const accepted = new Promise<void>((resolve) => {
    accept = resolve
  })
  await page.route("**/api/v1/chat", async (route) => {
    await accepted
    await route.fulfill({ contentType: "text/event-stream", body: acceptedStream })
  })
  const capabilities = page.waitForResponse((response) => response.url().includes("/chat/config"))
  await todosPage(page).open()
  await capabilities
  const chat = chatWidget(page)
  await chat.waitForReady()
  await chat.attach(note)
  await expect(chat.sendButton()).toBeEnabled()
  await chat.sendButton().click()
  await expect(
    page.getByRole("button", { name: `Remove ${note.name}`, exact: true }),
  ).toBeDisabled()
  accept()
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)
})

test("a missing session keeps fingerprint validation when upload discovery is unavailable", async ({
  page,
}) => {
  const capabilities = page.waitForResponse((response) => response.url().includes("/chat/config"))
  await todosPage(page).open()
  await capabilities
  const chat = chatWidget(page)
  await chat.waitForReady()
  const prepared = page.waitForResponse(
    (response) =>
      response.url().endsWith("/chat/uploads") && response.request().method() === "POST",
  )
  await chat.attach(note)
  const { id } = (await (await prepared).json()) as { id: string }
  await expect(chat.sendButton()).toBeEnabled()
  await page.route(`**/api/v1/chat/uploads/${id}`, (route) =>
    route.fulfill({ status: 404, json: { error: "Upload not found" } }),
  )
  await page.route("**/api/v1/chat/config?*", async (route) => {
    const response = await route.fetch()
    const { uploads: _uploads, ...capabilities } = (await response.json()) as Record<
      string,
      unknown
    >
    await route.fulfill({ json: capabilities })
  })
  await page.reload()
  await expect(page.getByText("Choose the original file to resume", { exact: true })).toBeVisible()
  const picker = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: `Resume ${note.name}`, exact: true }).click()
  await (await picker).setFiles({ ...note, buffer: Buffer.alloc(note.buffer.length, "x") })
  await expect(
    page.getByText("Choose the original file to resume this upload.", { exact: true }),
  ).toBeVisible()
  const original = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: `Resume ${note.name}`, exact: true }).click()
  await (await original).setFiles(note)
  await expect(chat.sendButton()).toBeEnabled()
})

test("failed removal survives reload and retries cancellation", async ({ page }) => {
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  const completed = page.waitForResponse((response) => response.url().endsWith("/complete"))
  await chat.attach(note)
  await completed
  await expect(chat.sendButton()).toBeEnabled()
  let cancellations = 0
  let rejectRemoval = () => {}
  await page.route("**/api/v1/chat/uploads/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue()
    cancellations++
    if (cancellations === 1) {
      await new Promise<void>((resolve) => {
        rejectRemoval = resolve
      })
      return route.fulfill({ status: 503, json: { error: "Unavailable" } })
    }
    await route.continue()
  })
  await chat.attachmentChip(note.name).click()
  await expect.poll(() => cancellations).toBe(1)
  await expect(chat.sendButton()).toBeDisabled()
  rejectRemoval()
  await expect(page.getByText("Removal failed. Try Remove again.", { exact: true })).toBeVisible()
  await captureMoment(page, "failed-file-removal-retains-the-draft")
  await page.reload()
  await expect(chat.attachmentChip(note.name)).toBeVisible()
  await chat.attachmentChip(note.name).click()
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)
  expect(cancellations).toBe(2)
})

test("the draft database upgrade preserves attachment metadata and removes legacy bytes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const open = indexedDB.open("astralbeam:drafts", 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore("attachments").put(
        [
          {
            id: "legacy",
            name: "legacy.txt",
            size: 5,
            mimeType: "text/plain",
            kind: "text",
            status: "ready",
            data: "aGVsbG8=",
            preview: "data:text/plain;base64,aGVsbG8=",
          },
        ],
        "legacy-draft",
      )
    }
    open.onsuccess = () => open.result.close()
  })
  await todosPage(page).open()
  await chatWidget(page).waitForReady()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<unknown>((resolve, reject) => {
            const open = indexedDB.open("astralbeam:drafts", 2)
            open.onsuccess = () => {
              const database = open.result
              const read = database
                .transaction("attachments")
                .objectStore("attachments")
                .get("legacy-draft")
              read.onsuccess = () => {
                resolve(read.result)
                database.close()
              }
              read.onerror = () => reject(read.error ?? new Error("Draft read failed"))
            }
            open.onerror = () => reject(open.error ?? new Error("Draft open failed"))
          }),
      ),
    )
    .toEqual([
      {
        id: "legacy",
        name: "legacy.txt",
        size: 5,
        mimeType: "text/plain",
        kind: "text",
        status: "reselect",
      },
    ])
})

test("resetting a fresh draft cancels its unclaimed upload", async ({ page }) => {
  const capabilities = page.waitForResponse((response) => response.url().includes("/chat/config"))
  await todosPage(page).open()
  await capabilities
  const chat = chatWidget(page)
  await chat.waitForReady()
  await chat.attach(note)
  await expect(chat.sendButton()).toBeEnabled()
  const cancelled = page.waitForResponse(
    (response) =>
      response.url().includes("/chat/uploads/") && response.request().method() === "DELETE",
  )
  await chat.reset()
  expect((await cancelled).status()).toBe(204)
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)
})

test("deleting an unopened persisted draft cancels its unfinished upload", async ({ page }) => {
  await page.route(
    (url) => url.searchParams.has("partNumber"),
    (route) => route.abort(),
  )
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  await chat.selectConversation(thread.title)
  const prepared = page.waitForResponse(
    (response) =>
      response.url().endsWith("/chat/uploads") && response.request().method() === "POST",
  )
  await chat.attach(note)
  const response = await prepared
  const { id } = (await response.json()) as { id: string }
  const authorization = (await response.request().allHeaders()).authorization!
  await expect(page.getByRole("button", { name: `Resume ${note.name}`, exact: true })).toBeVisible()
  await chat.selectConversation(otherThread.title)
  await page.reload()
  await chat.waitForReady()
  await expect(chat.attachmentChip(note.name)).toHaveCount(0)
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${thread.id}`,
    (route) => route.fulfill({ status: 204 }),
  )
  const cancelled = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/chat/uploads/${id}`) && response.request().method() === "DELETE",
  )
  await chat.root.getByRole("combobox", { name: "Show older chats", exact: true }).click()
  await page.getByRole("button", { name: `Delete ${thread.title}`, exact: true }).click()
  expect((await cancelled).status()).toBe(204)
  const status = await page.request.get(`${platformUrl}/api/v1/chat/uploads/${id}`, {
    headers: { authorization },
  })
  expect(await status.json()).toMatchObject({ status: "cancelled" })
})
