import { describe, expect, it } from "vitest"

import { clampSandboxText } from "./tools.server.ts"

describe("clampSandboxText", () => {
  it("passes text within the cap through untouched", () => {
    expect(clampSandboxText("hello", 10)).toEqual({ text: "hello", truncated: false })
  })

  it("elides the middle so a failing command's last line survives", () => {
    const clamped = clampSandboxText(`${"a".repeat(50)}THE-ERROR`, 20)
    expect(clamped.truncated).toBe(true)
    expect(clamped.text).toContain("characters omitted")
    expect(clamped.text.endsWith("THE-ERROR")).toBe(true)
  })
})
