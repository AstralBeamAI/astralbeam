import { mkdtemp, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { resolveCredentials, writeConfig } from "./config.ts"
import { run } from "./program.ts"

const API_KEY = `key_${"01990a5d-0000-7000-8000-000000000011"}_${"01990a5d-0000-7000-8000-000000000021"}_abo_${"a".repeat(64)}`
const API_URL = "http://beam.test/api"

let stdout = ""
let stderr = ""

beforeEach(async () => {
  stdout = ""
  stderr = ""
  vi.stubEnv("ASTRALBEAM_CONFIG_DIR", await mkdtemp(join(tmpdir(), "astralbeam-cli-test-")))
  vi.stubEnv("ASTRALBEAM_API_KEY", API_KEY)
  vi.stubEnv("ASTRALBEAM_API_URL", API_URL)
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => ((stdout += String(chunk)), true))
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => ((stderr += String(chunk)), true))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const cli = (...args: string[]) => run(["node", "astralbeam", ...args])

test("--all follows page_after with the API key and prints one merged page", async () => {
  const fetch = vi.fn((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    expect(new Headers(init?.headers).get("x-api-key")).toBe(API_KEY)
    const after = url.searchParams.get("page_after")
    const page = { items: [{ id: after ?? "first" }], page_after: after ? null : "cursor" }
    return Promise.resolve(Response.json({ ...page, page_before: null }))
  })
  vi.stubGlobal("fetch", fetch)

  expect(await cli("--json", "tenants", "list", "--all", "--external-id", "acme")).toBe(0)

  expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
    `${API_URL}/v1/tenants?filter%5Bexternal_id%5D=acme&page_size=100`,
    `${API_URL}/v1/tenants?filter%5Bexternal_id%5D=acme&page_size=100&page_after=cursor`,
  ])
  expect(JSON.parse(stdout)).toEqual({
    items: [{ id: "first" }, { id: "cursor" }],
    page_after: null,
    page_before: null,
  })
})

test("API failures exit 1 with the problem body, and usage errors exit 2", async () => {
  const problem = { type: "about:blank", title: "Conflict", status: 409, detail: "Taken." }
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json(problem, { status: 409 })))

  expect(await cli("--json", "tenants", "create", "--external-id", "acme")).toBe(1)
  expect(JSON.parse(stderr)).toEqual({ error: problem })

  expect(await cli("tenants", "create", "--metadata", "[1]", "--external-id", "acme")).toBe(2)
})

test("usage errors in JSON mode are JSON on stderr and exit 2", async () => {
  const usageError = async (...args: string[]) => {
    stderr = ""
    expect(await cli("--json", ...args)).toBe(2)
    return (JSON.parse(stderr) as { error: { detail: string } }).error.detail
  }

  expect(await usageError("tenants", "create")).toMatch(/--external-id/)
  expect(await usageError("tenants", "update", "id", "--metadata", "nope")).toMatch(/JSON object/)
  // Following page_after from a page_before request would send both cursors.
  expect(await usageError("tenants", "list", "--all", "--page-before", "c")).toMatch(/--all/)
})

test("an explicit profile overrides ASTRALBEAM_API_KEY and is stored owner-only", async () => {
  vi.stubEnv("ASTRALBEAM_API_URL", undefined)
  const stored = { api_url: "http://self-hosted.test/api", api_key: `${API_KEY.slice(0, -1)}b` }
  await writeConfig({ profiles: { staging: stored } })

  expect(await resolveCredentials("staging")).toEqual({
    apiKey: stored.api_key,
    apiUrl: stored.api_url,
    source: 'profile "staging"',
  })
  expect((await resolveCredentials(undefined)).source).toBe("ASTRALBEAM_API_KEY")
  const mode = (await stat(join(process.env["ASTRALBEAM_CONFIG_DIR"] ?? "", "config.json"))).mode
  expect(mode & 0o777).toBe(0o600)
})
