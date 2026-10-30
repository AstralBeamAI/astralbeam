import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { storedThreadAttachments, storedThreadDraft } from "./drafts.ts"

const values = new Map<string, string>()
beforeEach(() => {
  values.clear()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

afterEach(() => vi.unstubAllGlobals())

test("drafts survive reload reads and remain isolated by API, account, and thread", () => {
  storedThreadDraft("https://api.test/", "user-a", "thread-a", "  Unsent\ntext  ")
  storedThreadDraft("https://api.test", "user-a", "thread-b", "Another draft")
  expect(storedThreadDraft("https://api.test", "user-a", "thread-a")).toBe("  Unsent\ntext  ")
  expect(storedThreadDraft("https://api.test", "user-b", "thread-a")).toBe("")
  expect(storedThreadDraft("https://other.test", "user-a", "thread-a")).toBe("")
  storedThreadDraft("https://api.test", "user-a", "thread-a", "")
  expect(storedThreadDraft("https://api.test", "user-a", "thread-a")).toBe("")
  expect(storedThreadDraft("https://api.test", "user-a", "thread-b")).toBe("Another draft")
  storedThreadDraft("https://api.test", "", "thread-a", "Unverified")
  expect(values.size).toBe(1)
})

test("attachment references survive a move, while invalid storage is rejected without overwriting it", async () => {
  const scope = { apiUrl: "https://api.test", identity: "user-a" }
  const attachment = {
    id: "draft",
    name: "report.pdf",
    size: 12,
    mimeType: "application/pdf",
    kind: "pdf",
    status: "ready",
    fileId: "file",
  } as const
  await storedThreadAttachments({ ...scope, threadId: "old", update: () => [attachment] })
  await storedThreadAttachments({ ...scope, threadId: "old", moveTo: "new" })
  expect(await storedThreadAttachments({ ...scope, threadId: "new" })).toEqual([attachment])
  expect(await storedThreadAttachments({ ...scope, threadId: "old" })).toEqual([])
  const key = [...values.keys()][0]!
  for (const invalid of [
    "{",
    "null",
    "{}",
    "[null]",
    JSON.stringify([{ ...attachment, size: "12" }]),
    JSON.stringify([{ ...attachment, fileId: null }]),
  ]) {
    values.set(key, invalid)
    await expect(
      storedThreadAttachments({ ...scope, threadId: "new", update: () => [] }),
    ).rejects.toThrow()
    expect(values.get(key)).toBe(invalid)
  }
})
