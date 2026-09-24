import { mkdir, mkdtemp, realpath, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { configPath, writeConfig } from "./config.ts"
import { run } from "./program.ts"

const ORGANIZATION_ID = "01990a5d-0000-7000-8000-000000000011"
const API_KEY = `key_${ORGANIZATION_ID}_${"01990a5d-0000-7000-8000-000000000021"}_abo_${"a".repeat(64)}`
const API_URL = "https://beam.test/api"
const originalDirectory = process.cwd()
const context = { organization: { id: ORGANIZATION_ID }, bound_directory: null }

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
  process.chdir(originalDirectory)
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const cli = (...args: string[]) => run(["node", "astralbeam", ...args])
const respondWith = (body: unknown, status = 200) =>
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json(body, { status })))

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
  // JSON mode keeps stderr one JSON object, carrying the organization context.
  expect(JSON.parse(stderr)).toEqual({ context })
})

test("API failures exit 1 with the problem body, and usage errors exit 2", async () => {
  const problem = { type: "about:blank", title: "Conflict", status: 409, detail: "Taken." }
  respondWith(problem, 409)

  expect(await cli("--json", "tenants", "create", "--external-id", "acme")).toBe(1)
  expect(JSON.parse(stderr)).toEqual({ error: problem, context })
  stderr = ""
  expect(await cli("tenants", "create", "--external-id", "acme")).toBe(1)
  expect(stderr).toBe(
    `▸ org ${ORGANIZATION_ID} · from ASTRALBEAM_API_KEY\nError: Taken. (HTTP 409 from POST ${API_URL}/v1/tenants)\n`,
  )

  expect(await cli("tenants", "create", "--metadata", "[1]", "--external-id", "acme")).toBe(2)
})

test("usage errors in JSON mode are JSON on stderr and exit 2", async () => {
  const usageError = async (...args: string[]) => {
    stderr = ""
    expect(await cli("--json", ...args)).toBe(2)
    return (JSON.parse(stderr) as { error: { detail: string } }).error.detail
  }

  // Commands that need no credentials still end with one object, with a null context.
  expect(await cli("--json", "skill")).toBe(0)
  expect(JSON.parse(stderr)).toEqual({ context: null })

  expect(await usageError("tenants", "create")).toMatch(/--external-id/)
  expect(await usageError("tenants", "update", "id", "--metadata", "nope")).toMatch(/JSON object/)
  // Following page_after from a page_before request would send both cursors.
  expect(await usageError("tenants", "list", "--all", "--page-before", "c")).toMatch(/--all/)
  expect(
    await usageError("token", "chat", "--tenant", "t", "--user", "u", "--expires-in", "59"),
  ).toMatch(/60 to 600/)
})

test("the nearest bound directory supplies the key, and unbound directories fail", async () => {
  vi.stubEnv("ASTRALBEAM_API_KEY", undefined)
  const root = await realpath(await mkdtemp(join(tmpdir(), "astralbeam-cli-dirs-")))
  const nested = join(root, "acme", "app", "src")
  await mkdir(nested, { recursive: true })
  const organization = { id: ORGANIZATION_ID, name: "Acme", slug: "acme" }
  await writeConfig({
    bindings: {
      [root]: { api_url: API_URL, api_key: "outer", organization: { ...organization, id: "x" } },
      [join(root, "acme")]: { api_url: API_URL, api_key: API_KEY, organization },
    },
  })
  const fetch = vi.fn((_input: string | URL, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("x-api-key")).toBe(API_KEY)
    return Promise.resolve(Response.json({ items: [], page_after: null, page_before: null }))
  })
  vi.stubGlobal("fetch", fetch)

  process.chdir(nested)
  expect(await cli("tenants", "list")).toBe(0)
  expect(stderr).toContain(
    `▸ Acme (acme) · org ${ORGANIZATION_ID} · bound at ${join(root, "acme")}`,
  )
  expect((await stat(configPath())).mode & 0o777).toBe(0o600)

  process.chdir(tmpdir())
  stderr = ""
  expect(await cli("--json", "tenants", "list")).toBe(1)
  expect(stderr).toMatch(/No AstralBeam login covers/)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test("errors name unserved endpoints and unreachable servers", async () => {
  respondWith(
    { type: "about:blank", title: "Not Found", status: 404, detail: "Resource not found." },
    404,
  )
  expect(await cli("auth", "status")).toBe(1)
  expect(stderr).toContain(
    `(HTTP 404 from GET ${API_URL}/v1/organization)\nThis server does not serve that endpoint`,
  )

  vi.stubGlobal("fetch", () =>
    Promise.reject(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") })),
  )
  expect(await cli("tenants", "list")).toBe(1)
  expect(stderr).toContain(`Error: Could not reach ${API_URL}/v1/tenants: ECONNREFUSED`)
})

test("keys are never sent to a remote plaintext URL", async () => {
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)

  // A DNS name that merely starts like a loopback address is still remote.
  vi.stubEnv("ASTRALBEAM_API_URL", "http://127.evil.com/api")
  expect(await cli("tenants", "list")).toBe(1)
  vi.stubEnv("ASTRALBEAM_API_URL", "http://beam.example.com/api")
  expect(await cli("tenants", "list")).toBe(1)
  expect(await cli("auth", "login")).toBe(1)
  expect(stderr).toMatch(/must use https:\/\//)
  expect(fetch).not.toHaveBeenCalled()

  vi.stubEnv("ASTRALBEAM_API_URL", "http://127.0.0.1:4500/api")
  respondWith({ items: [], page_after: null, page_before: null })
  expect(await cli("tenants", "list")).toBe(0)
})

test("human-readable output escapes terminal control sequences from API data", async () => {
  respondWith({ id: "t1", name: "Acme\u001b]52;c;cHduZWQ=\u0007", metadata: {} })

  expect(await cli("tenants", "get", "t1")).toBe(0)
  expect(stdout).not.toContain("\u001b")
  expect(stdout).toContain("Acme\\u001b]52;c;cHduZWQ=\\u0007")
})
