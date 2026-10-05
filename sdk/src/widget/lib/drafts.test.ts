import { afterEach, expect, test, vi } from "vitest"
import { storedThreadDraft } from "./drafts.ts"

afterEach(() => vi.unstubAllGlobals())

test("drafts survive reload reads and remain isolated by API, account, and thread", () => {
  const values = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
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

test("unavailable browser storage does not break draft editing", () => {
  vi.stubGlobal("localStorage", undefined)
  expect(storedThreadDraft("https://api.test", "user", "thread", "Draft")).toBe("")
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("Storage disabled")
    },
    setItem: () => {
      throw new Error("Storage full")
    },
  })
  expect(storedThreadDraft("https://api.test", "user", "thread")).toBe("")
  expect(storedThreadDraft("https://api.test", "user", "thread", "Draft")).toBe("")
})
