import { Buffer } from "node:buffer"
import { expect, test, savedUserMessage, savedDirectoryMessages } from "../../fixtures.ts"
import { threadDirectoryPage } from "../../pages/thread-directory.ts"
import { openVanillaDirectories } from "../../pages/directories-page.ts"
import { captureMoment } from "../../capture.ts"
import { seedTarget } from "../../worktree.ts"
import { SEED_ORGANIZATIONS, SEED_USERS } from "../../../../../platform/scripts/seed/fixtures.ts"
import { createAstralBeamOrganizationToken, createAstralBeamToken } from "@astralbeam/sdk/server"

const savedThread = {
  id: "019a0800-0000-7000-8000-000000000001",
  tenant_id: "019a0800-0000-7000-8000-000000000002",
  title: "Support review",
  tenant_name: "Todos Example",
  tenant_external_id: "todos-tenant-1",
  participants: [
    { name: "Ada Example", external_id: "ada" },
    { name: null, external_id: "guest" },
  ],
  agent_id: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-06T00:00:00Z",
}
const uploadedFileId = "019a0800-0000-7000-8000-000000000098"

test("React conversation directory reads saved pages, uploads and decisions without executing actions", async ({
  page,
}) => {
  const directory = threadDirectoryPage(page)
  const mutations: string[] = []
  let previousTop: number | undefined
  page.on("request", (request) => {
    if (
      /\/api\/v1\/(?:chat|threads)/.test(request.url()) &&
      request.method() !== "GET" &&
      request.method() !== "OPTIONS"
    )
      mutations.push(request.url())
  })
  await page.route("**/api/v1/threads?*", (route) =>
    route.fulfill({ json: { items: [savedThread], page_after: null, page_before: null } }),
  )
  await page.route("**/api/v1/tenants/*/threads/*/messages?*", async (route) => {
    const earlier = new URL(route.request().url()).searchParams.has("page_after")
    if (earlier && previousTop === undefined) {
      await expect(directory.messages).toHaveJSProperty("scrollTop", 0)
      previousTop = (await directory.messages
        .locator('[data-message-id="context-0"]')
        .boundingBox())!.y
    }
    return route.fulfill({
      json: savedDirectoryMessages(
        savedThread,
        earlier
          ? [savedUserMessage("early", "Earlier support context")]
          : [
              ...Array.from({ length: 20 }, (_, index) =>
                savedUserMessage(`context-${index}`, `Support note ${index}`),
              ),
              {
                id: "input",
                role: "user",
                state: "complete",
                parts: [
                  {
                    id: "upload",
                    type: "document",
                    source: { type: "attachment", id: uploadedFileId, mimeType: "text/plain" },
                    metadata: { filename: "support-notes.txt" },
                  },
                ],
              },
              {
                id: "decision",
                role: "assistant",
                state: "draft",
                parts: [
                  {
                    id: "report",
                    type: "tool-call",
                    toolCallId: "publish",
                    name: "sandbox_publish_artifact",
                    arguments: "{}",
                    executionLocation: "sandbox",
                  },
                  {
                    id: "question",
                    type: "tool-call",
                    name: "ask_questionnaire",
                    toolCallId: "call",
                    arguments: '{"items":[{"question":"Approve?","choices":["Yes","No"]}]}',
                  },
                ],
              },
              {
                id: "publication",
                role: "tool",
                state: "complete",
                source_assistant_message_id: "decision",
                source_tool_part_id: "report",
                parts: [
                  {
                    id: "result",
                    type: "tool-result",
                    outcome: "succeeded",
                    output: {
                      fileId: "019a0800-0000-7000-8000-000000000099",
                      path: "/workspace/generated-report.txt",
                      mimeType: "text/plain",
                      size: 16,
                    },
                  },
                ],
              },
            ],
        earlier ? null : "earlier",
      ),
    })
  })
  await page.route(`**/api/v1/chat/files?*fileId=${uploadedFileId}*`, (route) => {
    if (route.request().headers()["x-file-preview"]) return route.fulfill({ status: 404 })
    return route.fulfill({ body: "Saved upload", contentType: "text/plain" })
  })
  await page.route(
    "**/api/v1/chat/files?*fileId=019a0800-0000-7000-8000-000000000099*",
    (route) => {
      expect(route.request().headers().authorization?.startsWith("Bearer ")).toBe(true)
      if (route.request().headers()["x-file-preview"]) return route.fulfill({ status: 404 })
      return route.fulfill({ body: "Generated report", contentType: "text/plain" })
    },
  )
  await directory.openReact()
  await directory.conversation(savedThread.title).click()
  await expect(directory.transcript).toContainText("Saved partial response")
  await expect(directory.transcript.getByRole("textbox")).toHaveCount(0)
  await expect(directory.transcript.getByRole("radio")).toHaveCount(0)
  await directory.transcript.getByRole("button", { name: "Saved ask_questionnaire" }).click()
  await expect(directory.transcript).toContainText("Approve?")
  await expect(directory.transcript).toContainText("No saved result.")
  await expect(directory.transcript).not.toContainText("Earlier support context")
  await expect(
    directory.transcript.getByRole("button", { name: "Load earlier messages" }),
  ).toHaveCount(0)
  await directory.messages.press("Home")
  await expect(directory.transcript).toContainText("Earlier support context")
  await expect
    .poll(async () =>
      Math.abs(
        (await directory.messages.locator('[data-message-id="context-0"]').boundingBox())!.y -
          previousTop!,
      ),
    )
    .toBeLessThan(5)
  const download = page.waitForEvent("download")
  await directory.transcript.getByRole("button", { name: "Download support-notes.txt" }).click()
  expect((await download).suggestedFilename()).toBe("support-notes.txt")
  await expect(directory.transcript.getByText("16 B", { exact: true })).toBeVisible()
  const generated = page.waitForEvent("download")
  await directory.transcript.getByRole("button", { name: "Download generated-report.txt" }).click()
  expect((await generated).suggestedFilename()).toBe("generated-report.txt")
  await expect(page.getByRole("alert")).toHaveCount(0)
  await captureMoment(page, "read-only-conversation-transcript")
  expect(mutations).toEqual([])
})

test("vanilla conversation directory follows cursors, filters Tenants and clears selected history on identity changes", async ({
  page,
}) => {
  const directory = threadDirectoryPage(page)
  let token = await createAstralBeamOrganizationToken({
    apiKey: seedTarget.apiKey,
    organizationId: seedTarget.organizationId,
    email: SEED_USERS[0].email,
  })
  await page.route("**/__listing-token", (route) => route.fulfill({ json: { token } }))
  const tenants = SEED_ORGANIZATIONS[0].tenants
  const filters: (string | null)[] = []
  await page.route("**/api/v1/threads?*", (route) => {
    const params = new URL(route.request().url()).searchParams
    filters.push(params.get("filter[tenant_id]"))
    const next = params.has("page_after")
    return route.fulfill({
      json: {
        items: [{ ...savedThread, title: next ? "Earlier review" : savedThread.title }],
        page_after: next ? null : "next",
        page_before: next ? "previous" : null,
      },
    })
  })
  await page.route("**/api/v1/tenants/*/threads/*/messages?*", (route) =>
    route.fulfill({
      json: savedDirectoryMessages(savedThread, [
        savedUserMessage("saved", "Private saved history"),
      ]),
    }),
  )
  await openVanillaDirectories(page, { scope: "organization" }, ["threads"])
  await expect(directory.directory).toContainText("Select a tenant to view its conversations.")
  expect(filters).toEqual([])
  await directory.selectTenant(tenants[0].name)
  await expect(directory.conversation(savedThread.title)).toBeVisible()
  await directory.next.click()
  await expect(directory.conversation("Earlier review")).toBeVisible()
  await directory.previous.click()
  await expect(directory.conversation(savedThread.title)).toBeVisible()
  expect(filters.at(-1)).not.toBeNull()
  await directory.clearTenant.click()
  await expect(directory.directory).toContainText("Select a tenant to view its conversations.")
  await expect(directory.conversation(savedThread.title)).toHaveCount(0)
  await directory.selectTenant(tenants[0].name)
  await directory.conversation(savedThread.title).click()
  await expect(directory.transcript).toContainText("Private saved history")
  token = await createAstralBeamOrganizationToken({
    apiKey: seedTarget.apiKey,
    organizationId: seedTarget.organizationId,
    email: SEED_USERS[1].email,
  })
  await page.getByRole("button", { name: "Reset", exact: true }).click()
  await expect(directory.transcript).toHaveCount(0)
  await expect(directory.directory).toContainText("Select a tenant to view its conversations.")
  await directory.selectTenant(tenants[0].name)
  await expect(directory.conversation(savedThread.title)).toBeVisible()
  await page.getByRole("button", { name: "Unmount", exact: true }).click()
  await expect(directory.directory).toHaveCount(0)
  await page.getByRole("button", { name: "Remount", exact: true }).click()
  await expect(directory.directory).toContainText("Select a tenant to view its conversations.")
  await directory.selectTenant(tenants[0].name)
  await expect(directory.conversation(savedThread.title)).toBeVisible()
  await captureMoment(page, "vanilla-conversation-directory")
})

test("non-admin Tenant credentials cannot browse conversations", async ({ page }) => {
  const directory = threadDirectoryPage(page)
  const token = await createAstralBeamToken({
    apiKey: seedTarget.apiKey,
    tenant: { id: seedTarget.tenant.id },
    user: { id: seedTarget.user.id, admin: false },
  })
  await page.route("**/__listing-token", (route) => route.fulfill({ json: { token } }))
  await openVanillaDirectories(page, { scope: "tenant" }, ["threads"])
  await expect(directory.directory.getByRole("alert")).toContainText(
    "Tenant administrator authority is required",
  )
  await expect(directory.directory.getByRole("table")).toHaveCount(0)
})

test("scrolling during refresh waits without canceling the latest history", async ({ page }) => {
  const directory = threadDirectoryPage(page)
  const thread = savedThread
  let firstRequests = 0,
    earlierRequests = 0
  let release!: () => void
  const refreshGate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/v1/threads?*", (route) =>
    route.fulfill({ json: { items: [thread], page_after: null, page_before: null } }),
  )
  await page.route("**/api/v1/tenants/*/threads/*/messages?*", async (route) => {
    const earlier = new URL(route.request().url()).searchParams.has("page_after")
    if (earlier) earlierRequests++
    else {
      firstRequests++
      if (firstRequests > 1) await refreshGate
    }
    await route.fulfill({
      json: savedDirectoryMessages(
        thread,
        earlier
          ? [savedUserMessage("earlier", "Older context")]
          : Array.from({ length: 20 }, (_, i) =>
              savedUserMessage(
                `context-${i}`,
                firstRequests > 1 && i === 19 ? "Updated latest message" : `Saved context ${i}`,
              ),
            ),
        earlier ? null : "earlier",
      ),
    })
  })
  await directory.openReact()
  await directory.conversation(thread.title).click()
  await expect(directory.transcript).toContainText("Saved context 19")
  await directory.refresh.click()
  await expect.poll(() => firstRequests).toBe(2)
  await directory.messages.press("Home")
  expect(earlierRequests).toBe(0)
  release()
  await expect(directory.transcript).toContainText("Updated latest message")
  await expect(directory.transcript).toContainText("Older context")
  expect(earlierRequests).toBe(1)
})

for (const status of [503, 403]) {
  test(`earlier history failure ${status} preserves history only while access remains valid`, async ({
    page,
  }) => {
    const directory = threadDirectoryPage(page)
    let earlierRequests = 0
    await page.route("**/api/v1/threads?*", (route) =>
      route.fulfill({ json: { items: [savedThread], page_after: null, page_before: null } }),
    )
    await page.route("**/api/v1/tenants/*/threads/*/messages?*", (route) => {
      const earlier = new URL(route.request().url()).searchParams.has("page_after")
      if (earlier && ++earlierRequests === 1)
        return route.fulfill({
          status,
          json: {
            type: "about:blank",
            title: "History unavailable",
            status,
            detail: "Earlier history unavailable",
          },
        })
      return route.fulfill({
        json: savedDirectoryMessages(
          savedThread,
          Array.from({ length: earlier ? 1 : 20 }, (_, i) =>
            savedUserMessage(
              `${earlier ? "older" : "saved"}-${i}`,
              `${earlier ? "Older" : "Saved"} context ${i}`,
            ),
          ),
          earlier ? null : "earlier",
        ),
      })
    })
    await directory.openReact()
    await directory.conversation(savedThread.title).click()
    await expect(directory.transcript).toContainText("Saved context 19")
    const viewport = await directory.messages.elementHandle()
    await directory.messages.press("Home")
    await expect(directory.transcript.getByRole("alert")).toContainText(
      "Earlier history unavailable",
    )
    if (status === 403) {
      await expect(directory.messages).toHaveCount(0)
      await expect(directory.transcript).not.toContainText("Saved context 19")
    } else {
      expect(await viewport.evaluate((element) => element.isConnected)).toBe(true)
      await expect(directory.transcript).toContainText("Saved context 19")
      await expect.poll(() => directory.messages.evaluate((element) => element.scrollTop)).toBe(0)
      await captureMoment(page, "Pagination failure retains saved history")
      await directory.transcript.getByRole("button", { name: "Retry", exact: true }).click()
      await expect(directory.transcript).toContainText("Older context 0")
      await expect(directory.transcript.getByRole("alert")).toHaveCount(0)
      expect(earlierRequests).toBe(2)
    }
  })
}

for (const status of [401, 403, 404]) {
  test(`attachment denial ${status} hides cached administrative history`, async ({ page }) => {
    const directory = threadDirectoryPage(page)
    await page.route("**/api/v1/threads?*", (route) =>
      route.fulfill({ json: { items: [savedThread], page_after: null, page_before: null } }),
    )
    await page.route("**/api/v1/tenants/*/threads/*/messages?*", (route) =>
      route.fulfill({
        json: savedDirectoryMessages(savedThread, [
          {
            id: "input",
            role: "user",
            state: "complete",
            parts: [
              { id: "text", type: "text", content: "Private saved context" },
              {
                id: "upload",
                type: "document",
                source: { type: "attachment", id: uploadedFileId, mimeType: "text/plain" },
                metadata: { filename: "support-notes.txt" },
              },
            ],
          },
        ]),
      }),
    )
    await page.route(`**/api/v1/chat/files?*fileId=${uploadedFileId}*`, (route) =>
      route.request().headers()["x-file-preview"]
        ? route.fulfill({ status: 204 })
        : route.fulfill({
            status,
            json: { type: "about:blank", title: "Access denied", status, detail: "Access denied" },
          }),
    )
    await directory.openReact()
    await directory.conversation(savedThread.title).click()
    await expect(directory.transcript).toContainText("Private saved context")
    await directory.transcript.getByRole("button", { name: "Download support-notes.txt" }).click()
    await expect(directory.transcript.getByRole("alert")).toContainText("Access denied")
    await expect(directory.messages).toHaveCount(0)
    await expect(directory.transcript).not.toContainText("Private saved context")
    await directory.transcript.getByRole("button", { name: "Retry", exact: true }).click()
    await expect(directory.transcript).toContainText("Private saved context")
    await expect(directory.transcript.getByRole("alert")).toHaveCount(0)
  })
}

test("refresh preserves saved image previews without downloading again", async ({ page }) => {
  const directory = threadDirectoryPage(page)
  const thread = savedThread
  let images = 0
  let histories = 0
  await page.route("**/api/v1/threads?*", (route) =>
    route.fulfill({ json: { items: [thread], page_after: null, page_before: null } }),
  )
  await page.route("**/api/v1/tenants/*/threads/*/messages?*", (route) => {
    histories++
    return route.fulfill({
      json: savedDirectoryMessages(thread, [
        {
          id: "input",
          role: "user",
          state: "complete",
          parts: [
            {
              id: "picture",
              type: "image",
              source: { type: "attachment", id: uploadedFileId, mimeType: "image/png" },
              metadata: { filename: "picture.png" },
            },
          ],
        },
      ]),
    })
  })
  await page.route(`**/api/v1/chat/files?*fileId=${uploadedFileId}*`, (route) => {
    expect(route.request().headers()["x-file-preview"]).toBe("true")
    images++
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVuoAAAAASUVORK5CYII=",
        "base64",
      ),
    })
  })
  await directory.openReact()
  await directory.conversation(thread.title).click()
  await expect(directory.transcript.locator("img")).toHaveAttribute("src", /^blob:/)
  const preview = await directory.transcript.locator("img").getAttribute("src")
  await directory.refresh.click()
  await expect.poll(() => histories).toBe(2)
  await expect(directory.refresh).toBeEnabled()
  await expect(directory.transcript.locator("img")).toHaveAttribute("src", preview!)
  expect(images).toBe(1)
})
