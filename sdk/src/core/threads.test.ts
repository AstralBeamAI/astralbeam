import { expect, test, vi } from "vitest"
import { loadThreadMessages, projectThreadMessages } from "./threads.ts"

test("saved history preserves interrupted authorship without fetching attachment bytes", async () => {
  const fetchClient = vi.fn<typeof fetch>((input, init) => {
    const request = new Request(input, init)
    expect(request.headers.get("authorization")).toBe("Bearer current-token")
    return Promise.resolve(
      Response.json({
        thread: { id: "conversation", writer_active: false },
        messages: [
          {
            id: "message",
            role: "user",
            state: "complete",
            parts: [
              { id: "image", type: "image", source: { type: "attachment", mimeType: "image/png" } },
            ],
            author_tenant_user_id: "participant",
            created_at: "2026-10-02T00:00:00Z",
          },
          {
            id: "assistant",
            role: "assistant",
            state: "interrupted",
            parts: [{ id: "text", type: "text", content: "Partial reply" }],
            author_tenant_user_id: null,
            created_at: "2026-10-02T00:00:00Z",
          },
        ],
        pending_interactions: [],
        page_after: null,
        page_before: null,
      }),
    )
  })
  const options = { astralBeamToken: "current-token", fetchClient }
  const history = await loadThreadMessages("conversation", options)
  const messages = projectThreadMessages(history.messages)
  expect(fetchClient).toHaveBeenCalledTimes(1)
  expect(messages[0]).toMatchObject({
    id: "message",
    metadata: { astralbeam: { state: "complete", authorTenantUserId: "participant" } },
    parts: [
      { source: { type: "url", value: "", mimeType: "image/png" }, savedAttachmentId: "image" },
    ],
  })
  expect(messages[1]?.metadata).toEqual({
    astralbeam: { state: "interrupted", authorTenantUserId: null },
  })
})
