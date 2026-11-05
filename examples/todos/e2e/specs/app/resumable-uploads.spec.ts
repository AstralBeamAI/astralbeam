import { Buffer } from "node:buffer"
import { expect, test } from "../../fixtures.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { todosPage } from "../../pages/todos-page.ts"
import { captureMoment } from "../../capture.ts"
import { mintSeedChatAuthToken } from "../../tokens.ts"
import { platformUrl, seedTarget } from "../../worktree.ts"

test.describe("S3 resumable uploads", () => {
  test.beforeEach(async ({ request }) => {
    const token = await mintSeedChatAuthToken(seedTarget.apiKey)
    const response = await request.get(
      `${platformUrl}/api/v1/chat/config?agentId=${seedTarget.agentId}`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    expect(response.status()).toBe(200)
    const body = (await response.json()) as { capabilities: { uploads: { available: boolean } } }
    test.skip(
      !body.capabilities.uploads.available,
      "Direct multipart uploads require S3-compatible storage",
    )
  })

  test("multipart uploads wait for discovery, pause, and resume only with the original file after reload", async ({
    page,
  }) => {
    const discovery = Promise.withResolvers<void>()
    await page.route("**/api/v1/chat/config*", async (route) => {
      await discovery.promise
      await route.continue()
    })
    const firstPart = Promise.withResolvers<void>()
    const paused = Promise.withResolvers<void>()
    let held = false
    await page.route("**/*uploadId=*", async (route) => {
      const url = new URL(route.request().url())
      if (
        route.request().method() === "PUT" &&
        url.searchParams.get("partNumber") === "1" &&
        !held
      ) {
        held = true
        firstPart.resolve()
        await paused.promise
        await route.abort().catch(() => undefined)
      } else await route.continue()
    })
    const buffer = Buffer.alloc(9 * 1024 * 1024, " ")
    buffer.write("%PDF-1.7\n")
    const file = { name: "resumable.pdf", mimeType: "application/pdf", buffer }
    try {
      await todosPage(page).open()
      const chat = chatWidget(page)
      await chat.waitForReady()
      await expect(
        chat.root.getByRole("button", { name: "Attach files", exact: true }),
      ).toHaveCount(0)
      discovery.resolve()
      await chat.attach(file)
      await firstPart.promise
      await chat.root.getByRole("button", { name: "Pause upload", exact: true }).click()
      paused.resolve()
      await expect(chat.root.getByText("Upload paused", { exact: true })).toBeVisible()
      await page.reload()
      await chat.waitForReady()
      await expect(
        chat.root.getByText("Choose the original file to resume", { exact: true }),
      ).toBeVisible()
      const saved = await page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("astralbeam:attachments:"))
          .map((key) => localStorage.getItem(key) ?? "")
          .join(""),
      )
      expect(saved).toContain("sha256")
      expect(saved).not.toContain("%PDF")
      expect(saved).not.toContain("X-Amz")
      const wrong = Buffer.from(buffer)
      wrong[100] = 1
      const chooseWrong = page.waitForEvent("filechooser")
      await chat.root.getByRole("button", { name: "Resume upload", exact: true }).click()
      await (await chooseWrong).setFiles({ ...file, buffer: wrong })
      await expect(
        chat.root.getByText("Choose the original file to resume this upload.", { exact: true }),
      ).toBeVisible()
      const chooseOriginal = page.waitForEvent("filechooser")
      await chat.root.getByRole("button", { name: "Resume upload", exact: true }).click()
      await (await chooseOriginal).setFiles(file)
      await expect(chat.sendButton()).toBeEnabled()
      await captureMoment(page, "resumed-multipart-upload-ready")
      await chat.attachmentChip(file.name).click()
      await expect(chat.attachmentChip(file.name)).toHaveCount(0)
    } finally {
      discovery.resolve()
      paused.resolve()
    }
  })

  test("a file paused in the queue can resume before its fingerprint exists", async ({ page }) => {
    const occupied = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let parts = 0
    await page.route("**/*uploadId=*", async (route) => {
      if (route.request().method() === "PUT") {
        if (++parts === 2) occupied.resolve()
        await release.promise
      }
      await route.continue()
    })
    try {
      await todosPage(page).open()
      const chat = chatWidget(page)
      await chat.waitForReady()
      await chat.attach(
        [1, 2, 3].map((number) => ({
          name: `queued-${number}.txt`,
          mimeType: "text/plain",
          buffer: Buffer.from("Queued file"),
        })),
      )
      await occupied.promise
      await chat.root.getByRole("button", { name: "Pause upload", exact: true }).nth(2).click()
      await expect(chat.root.getByText("Upload paused", { exact: true })).toBeVisible()
      await captureMoment(page, "queued-upload-paused-before-fingerprint")
      await chat.root.getByRole("button", { name: "Resume upload", exact: true }).click()
      release.resolve()
      await expect(chat.sendButton()).toBeEnabled()
      await chat.reset()
      await expect(chat.attachmentChip("queued-3.txt")).toHaveCount(0)
    } finally {
      release.resolve()
    }
  })

  test("fresh draft cancellation blocks edits and file changes until it settles", async ({
    page,
  }) => {
    await todosPage(page).open()
    const chat = chatWidget(page)
    await chat.waitForReady()
    await chat.attach({
      name: "discard.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Discard file"),
    })
    await expect(chat.sendButton()).toBeEnabled()
    await chat.composer().fill("Discard this draft")
    const cancelling = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    await page.route("**/api/v1/chat/uploads/*", async (route) => {
      if (route.request().method() === "DELETE") {
        cancelling.resolve()
        await release.promise
      }
      await route.continue()
    })
    try {
      await chat.reset()
      await cancelling.promise
      await expect(chat.composer()).toBeDisabled()
      await expect(
        chat.root.getByRole("button", { name: "Attach files", exact: true }),
      ).toBeDisabled()
      await expect(chat.attachmentChip("discard.txt")).toBeDisabled()
      await expect(chat.composer()).toHaveValue("Discard this draft")
      await captureMoment(page, "composer-disabled-during-draft-discard")
      release.resolve()
      await expect(chat.composer()).toBeEnabled()
      await expect(chat.composer()).toHaveValue("")
      await expect(chat.attachmentChip("discard.txt")).toHaveCount(0)
    } finally {
      release.resolve()
    }
  })

  test("a failed upload cancellation retains its recoverable draft across reload", async ({
    page,
  }) => {
    await todosPage(page).open()
    const chat = chatWidget(page)
    await chat.waitForReady()
    const file = {
      name: "retry-removal.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A recoverable file"),
    }
    await chat.attach(file)
    await expect(chat.sendButton()).toBeEnabled()
    await page.route("**/api/v1/chat/uploads/*", async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 503,
          json: { type: "about:blank", status: 503, detail: "Temporary storage failure" },
        })
      } else await route.continue()
    })
    await chat.attachmentChip(file.name).click()
    await expect(
      chat.root.getByText("Removal failed. Try Remove again.", { exact: true }),
    ).toBeVisible()
    await captureMoment(page, "failed-cancellation-preserves-draft")
    await page.unroute("**/api/v1/chat/uploads/*")
    await page.reload()
    await chat.waitForReady()
    await expect(chat.attachmentChip(file.name)).toBeVisible()
    await chat.attachmentChip(file.name).click()
    await expect(chat.attachmentChip(file.name)).toHaveCount(0)
  })
})

test("browsers without Web Crypto retain the server upload fallback", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(globalThis.crypto, "subtle", { value: undefined }),
  )
  await todosPage(page).open()
  const chat = chatWidget(page)
  await chat.waitForReady()
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/chat/files",
  )
  const file = {
    name: "fallback.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("A fallback upload"),
  }
  await chat.attach(file)
  expect((await uploaded).status()).toBe(200)
  await expect(chat.sendButton()).toBeEnabled()
  await chat.attachmentChip(file.name).click()
  await expect(chat.attachmentChip(file.name)).toHaveCount(0)
})
