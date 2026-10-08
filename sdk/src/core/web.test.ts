import { describe, expect, test } from "vitest"
import { citedWebText, readWebEvidence } from "./web.ts"
import { isSettledToolCall, lastPartInProgress } from "./messages.ts"
import { projectThreadMessages } from "./threads.ts"
import type { ChatHistoryPageEncodedMessagesItem } from "../api/generated/api.ts"

describe("portable web evidence", () => {
  test("inline citations use UTF-16 offsets and discard unsafe or invalid links", () => {
    const content = "🛰 Evidence."
    const metadata = {
      web: {
        sources: [{ url: "javascript:alert(1)", title: "unsafe" }],
        citations: [
          {
            url: "https://example.com/a(b)",
            title: "Source",
            startIndex: 3,
            endIndex: content.length,
          },
          { url: "https://user:secret@example.com/", startIndex: 0, endIndex: 1 },
          { url: "https://example.com/", startIndex: -1, endIndex: 2 },
        ],
      },
    }
    expect(readWebEvidence(metadata).sources).toEqual([])
    expect(citedWebText(content, metadata)).toBe("🛰 Evidence. [1](https://example.com/a%28b%29)")
  })

  test("provider activity stays settled with the same saved part identity after reload", () => {
    const part = {
      id: "stable-part",
      type: "tool-call",
      name: "web_search",
      toolCallId: "upstream",
      arguments: "{}",
      state: "complete",
      executionLocation: "provider",
      targets: [],
      metadata: {
        providerExecuted: true,
        web: { sources: [{ url: "https://example.com/", title: "Example" }], citations: [] },
      },
    }
    const records = [
      {
        id: "message",
        role: "assistant",
        state: "complete",
        parts: [part],
        created_at: new Date().toISOString(),
        author_tenant_user_id: null,
      },
    ] as unknown as ChatHistoryPageEncodedMessagesItem[]
    const reloaded = projectThreadMessages(records)[0]!.parts[0]!
    if (reloaded.type !== "tool-call") throw new Error("Expected saved provider activity")
    expect(reloaded.id).toBe(part.id)
    expect(isSettledToolCall(reloaded)).toBe(true)
    expect(reloaded).toMatchObject({ metadata: part.metadata })
    const running = { ...reloaded, state: "input-streaming" as const }
    expect(isSettledToolCall(running)).toBe(false)
    expect(lastPartInProgress([{ id: "live", role: "assistant", parts: [running] }])).toBe(true)
  })
})
