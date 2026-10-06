import { Buffer } from "node:buffer"
import { expect, test } from "../../fixtures.ts"
import { threadDirectoryPage } from "../../pages/thread-directory.ts"
import { openVanillaDirectories } from "../../pages/directories-page.ts"
import { captureMoment } from "../../capture.ts"
import { seedTarget } from "../../worktree.ts"
import { SEED_ORGANIZATIONS, SEED_USERS } from "../../../../../platform/scripts/seed/fixtures.ts"
// @deno-types="../../../../../sdk/dist/server.d.ts"
import {
  createAstralBeamOrganizationToken,
  createAstralBeamToken,
} from "../../../../../sdk/dist/server.js"

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

test("React conversation directory reads saved pages, uploads and decisions without executing actions", async ({
  page,
}) => {
  const directory = threadDirectoryPage(page)
  const mutations: string[] = []
  let hasConversations = true
  let previousTop: number | undefined
  page.on("request", (request) => {
    if (
      /\/api\/v1\/(?:chat|threads)/.test(request.url()) &&
      request.method() !== "GET" &&
      request.method() !== "OPTIONS"
    )
      mutations.push(request.url())
  })
  await page.route("**/api/v1/threads?*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? ""
    return route.fulfill({
      json: {
        items:
          hasConversations && (!q || savedThread.title.toLowerCase().includes(q.toLowerCase()))
            ? [savedThread]
            : [],
        page_after: null,
        page_before: null,
      },
    })
  })
  await page.route("**/api/v1/tenants/*/threads/*/messages?*", async (route) => {
    const earlier = new URL(route.request().url()).searchParams.has("page_after")
    if (earlier && previousTop === undefined) {
      await expect(directory.messages).toHaveJSProperty("scrollTop", 0)
      previousTop = (await directory.messages
        .locator('[data-message-id="context-0"]')
        .boundingBox())!.y
    }
    return route.fulfill({
      json: {
        thread: savedThread,
        messages: earlier
          ? [
              {
                id: "early",
                role: "user",
                state: "complete",
                parts: [{ id: "text", type: "text", content: "Earlier support context" }],
              },
            ]
          : [
              ...Array.from({ length: 20 }, (_, index) => ({
                id: `context-${index}`,
                role: "user",
                state: "complete",
                parts: [{ id: "text", type: "text", content: `Support note ${index}` }],
              })),
              {
                id: "input",
                role: "user",
                state: "complete",
                parts: [
                  {
                    id: "upload",
                    type: "document",
                    source: { type: "attachment", mimeType: "text/plain" },
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
                    id: "question",
                    type: "tool-call",
                    name: "ask_questionnaire",
                    toolCallId: "call",
                    arguments: '{"items":[{"question":"Approve?","choices":["Yes","No"]}]}',
                  },
                ],
              },
            ],
        page_after: earlier ? null : "earlier",
        page_before: null,
      },
    })
  })
  await page.route("**/api/v1/tenants/*/threads/*/messages/input/attachments/upload", (route) =>
    route.fulfill({ body: "Saved upload", contentType: "text/plain" }),
  )
  await directory.openReact()
  await expect(
    directory.directory.getByRole("columnheader", { name: "Participants", exact: true }),
  ).toBeVisible()
  await expect(
    directory.directory.getByRole("columnheader", { name: "Tenant", exact: true }),
  ).toHaveCount(0)
  await expect(
    directory.directory.getByRole("row").filter({ hasText: savedThread.title }),
  ).toContainText("Ada Example")
  await expect(
    directory.directory.getByRole("row").filter({ hasText: savedThread.title }),
  ).toContainText("guest")
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
  await directory.refresh.click()
  await captureMoment(page, "read-only-conversation-transcript")
  expect(mutations).toEqual([])
  await directory.back.click()
  await directory.search.fill("missing")
  await expect(directory.directory).toContainText("No conversations match your filters")
  await page.setViewportSize({ width: 320, height: 844 })
  await directory.search.fill("")
  await expect(directory.conversation(savedThread.title)).toBeVisible()
  expect(
    await directory.directory.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await captureMoment(page, "conversation-directory-mobile")
  hasConversations = false
  await directory.refresh.click()
  await expect(directory.directory).toContainText("No conversations yet.")
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
      json: {
        thread: savedThread,
        messages: [
          {
            id: "saved",
            role: "user",
            state: "complete",
            parts: [{ id: "text", type: "text", content: "Private saved history" }],
          },
        ],
        page_after: null,
        page_before: null,
      },
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

test("empty projected history pages automatically load earlier messages", async ({ page }) => {
  const directory = threadDirectoryPage(page)
  const thread = savedThread
  let earlierRequests = 0
  await page.route("**/api/v1/threads?*", (route) =>
    route.fulfill({ json: { items: [thread], page_after: null, page_before: null } }),
  )
  await page.route("**/api/v1/tenants/*/threads/*/messages?*", (route) => {
    const earlier = new URL(route.request().url()).searchParams.has("page_after")
    if (earlier) earlierRequests++
    return route.fulfill({
      json: {
        thread,
        messages:
          earlierRequests === 2
            ? [
                {
                  id: "earlier",
                  role: "user",
                  state: "complete",
                  parts: [{ id: "text", type: "text", content: "Earlier context" }],
                },
              ]
            : Array.from({ length: 100 }, (_, i) => ({
                id: `result-${earlierRequests}-${i}`,
                role: "tool",
                state: "complete",
                source_assistant_message_id: "assistant",
                source_tool_part_id: "call",
                response_target_id: `target-${i}`,
                parts: [
                  { id: "result", type: "tool-result", output: { ok: true }, outcome: "succeeded" },
                ],
              })),
        page_after: earlierRequests === 2 ? null : `earlier-${earlierRequests}`,
        page_before: null,
      },
    })
  })
  await directory.openReact()
  await directory.conversation(thread.title).click()
  await expect(directory.transcript).toBeVisible()
  await expect(directory.transcript).toContainText("Earlier context")
  expect(earlierRequests).toBe(2)
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
      json: {
        thread,
        messages: earlier
          ? [
              {
                id: "earlier",
                role: "user",
                state: "complete",
                parts: [{ id: "text", type: "text", content: "Older context" }],
              },
            ]
          : Array.from({ length: 20 }, (_, i) => ({
              id: `context-${i}`,
              role: "user",
              state: "complete",
              parts: [
                {
                  id: "text",
                  type: "text",
                  content:
                    firstRequests > 1 && i === 19 ? "Updated latest message" : `Saved context ${i}`,
                },
              ],
            })),
        page_after: earlier ? null : "earlier",
        page_before: null,
      },
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
        json: {
          thread: savedThread,
          messages: Array.from({ length: earlier ? 1 : 20 }, (_, i) => ({
            id: `${earlier ? "older" : "saved"}-${i}`,
            role: "user",
            state: "complete",
            parts: [
              { id: "text", type: "text", content: `${earlier ? "Older" : "Saved"} context ${i}` },
            ],
          })),
          page_after: earlier ? null : "earlier",
          page_before: null,
        },
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
      expect(await directory.messages.evaluate((element) => element.scrollTop)).toBe(0)
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
        json: {
          thread: savedThread,
          messages: [
            {
              id: "input",
              role: "user",
              state: "complete",
              parts: [
                { id: "text", type: "text", content: "Private saved context" },
                {
                  id: "upload",
                  type: "document",
                  source: { type: "attachment", mimeType: "text/plain" },
                  metadata: { filename: "support-notes.txt" },
                },
              ],
            },
          ],
          page_after: null,
          page_before: null,
        },
      }),
    )
    await page.route("**/api/v1/tenants/*/threads/*/messages/input/attachments/upload", (route) =>
      route.fulfill({
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
      json: {
        thread,
        messages: [
          {
            id: "input",
            role: "user",
            state: "complete",
            parts: [
              {
                id: "picture",
                type: "image",
                source: { type: "attachment", mimeType: "image/png" },
                metadata: { filename: "picture.png" },
              },
            ],
          },
        ],
        page_after: null,
        page_before: null,
      },
    })
  })
  await page.route("**/api/v1/tenants/*/threads/*/messages/input/attachments/picture", (route) => {
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
