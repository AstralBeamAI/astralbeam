import { describe, expect, it } from "vitest"

import { CHAT_SANDBOX_ROOT } from "./constants.server.ts"
import { clampSandboxText, resolveSandboxPath } from "./sandbox-tools.server.ts"

// Daytona's real workspace directory, which is what makes the virtual-root mapping load-bearing.
const REAL_ROOT = "/home/daytona/workspace"

/** The refusal a path earns, or undefined when it resolved. Keeps the assertions typed. */
function sandboxPathRefusal(root: string, path: string): string | undefined {
  const resolved = resolveSandboxPath(root, path)
  return "refusal" in resolved ? resolved.refusal : undefined
}

describe("resolveSandboxPath", () => {
  it("resolves a relative path against the real workspace root", () => {
    expect(resolveSandboxPath(REAL_ROOT, "src/app.py")).toEqual({
      path: `${REAL_ROOT}/src/app.py`,
      relativePath: "src/app.py",
    })
  })

  it("maps a virtual root path onto the provider's real one", () => {
    // The agent will type `/workspace/app.py` even when the provider mounts it elsewhere, and the
    // shell would not find it there.
    expect(resolveSandboxPath(REAL_ROOT, `${CHAT_SANDBOX_ROOT}/app.py`)).toEqual({
      path: `${REAL_ROOT}/app.py`,
      relativePath: "app.py",
    })
  })

  it("accepts a real absolute path inside the root, which is what results report", () => {
    expect(resolveSandboxPath(REAL_ROOT, `${REAL_ROOT}/app.py`)).toEqual({
      path: `${REAL_ROOT}/app.py`,
      relativePath: "app.py",
    })
  })

  it("normalizes redundant segments without leaving the root", () => {
    expect(resolveSandboxPath(REAL_ROOT, `${REAL_ROOT}/src/./nested/../app.py`)).toEqual({
      path: `${REAL_ROOT}/src/app.py`,
      relativePath: "src/app.py",
    })
  })

  it("allows the root itself, which is what a bare listing asks for", () => {
    expect(resolveSandboxPath(REAL_ROOT, REAL_ROOT)).toEqual({
      path: REAL_ROOT,
      relativePath: ".",
    })
    expect(resolveSandboxPath(REAL_ROOT, CHAT_SANDBOX_ROOT)).toEqual({
      path: REAL_ROOT,
      relativePath: ".",
    })
  })

  it("refuses a traversal that climbs out of the root", () => {
    expect(sandboxPathRefusal(REAL_ROOT, `${REAL_ROOT}/../../etc/passwd`)).toContain(REAL_ROOT)
    expect(sandboxPathRefusal(REAL_ROOT, `${CHAT_SANDBOX_ROOT}/../etc/passwd`)).toBeTypeOf("string")
  })

  it("refuses an absolute path outside the root", () => {
    expect(sandboxPathRefusal(REAL_ROOT, "/etc/passwd")).toBeTypeOf("string")
  })

  it("refuses a prefix that only looks like the root", () => {
    expect(sandboxPathRefusal(REAL_ROOT, `${REAL_ROOT}-other/app.py`)).toBeTypeOf("string")
  })

  it("leaves paths alone when the provider's root is already the virtual one", () => {
    expect(resolveSandboxPath(CHAT_SANDBOX_ROOT, `${CHAT_SANDBOX_ROOT}/app.py`)).toEqual({
      path: `${CHAT_SANDBOX_ROOT}/app.py`,
      relativePath: "app.py",
    })
    expect(sandboxPathRefusal(CHAT_SANDBOX_ROOT, "/etc/passwd")).toBeTypeOf("string")
  })
})

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
