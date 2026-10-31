import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { configPath, readConfig, writeConfig } from "./config.ts"
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

test("skill installation defaults to the project and honors --dir", async () => {
  const project = await mkdtemp(join(tmpdir(), "astralbeam-cli-skill-"))
  const content = await readFile(
    new URL("../../skills/astralbeam/SKILL.md", import.meta.url),
    "utf8",
  )
  process.chdir(project)
  expect(await cli("--json", "skill", "install")).toBe(0)
  expect(await readFile(join(project, ".agents/skills/astralbeam/SKILL.md"), "utf8")).toBe(content)
  expect(await cli("--json", "skill", "install", "--dir", join(project, "custom-skills"))).toBe(0)
  expect(await readFile(join(project, "custom-skills/astralbeam/SKILL.md"), "utf8")).toBe(content)
})

test.each(["-q", "--search"])(
  "%s preserves search and exact filters with table output",
  async (search) => {
    vi.stubEnv("ASTRALBEAM_TOKEN", "fixture.jwt.secret")
    const fetch = vi.fn((input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `${API_URL}/v1/tenants?q=customer&filter%5Bexternal_id%5D=customer-42`,
      )
      expect(new Headers(init?.headers).get("x-api-key")).toBe(API_KEY)
      expect(new Headers(init?.headers).has("authorization")).toBe(false)
      expect(init?.redirect).toBe("error")
      return Promise.resolve(Response.json({ items: [{ id: "first" }], page_after: "cursor" }))
    })
    vi.stubGlobal("fetch", fetch)
    expect(await cli("tenants", "list", search, "customer", "--external-id", "customer-42")).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(stdout).toBe("ID\nfirst\n")
    expect(stderr).toContain("More results: --page-after cursor")
    expect(stderr).toContain(`org ${ORGANIZATION_ID}`)
    expect(stdout + stderr).not.toContain(API_KEY)
  },
)

test("API failures exit 1 with structured errors", async () => {
  const problem = { type: "about:blank", title: "Conflict", status: 409, detail: "Taken." }
  respondWith(problem, 409)

  expect(await cli("--json", "tenants", "create", "--external-id", "acme")).toBe(1)
  expect(JSON.parse(stderr)).toEqual({ error: problem, context })
  stderr = ""
  expect(await cli("tenants", "create", "--external-id", "acme")).toBe(1)
  expect(stderr).toBe(
    `▸ org ${ORGANIZATION_ID} · from ASTRALBEAM_API_KEY\nError: Taken. (HTTP 409 from POST ${API_URL}/v1/tenants)\n`,
  )
})

test("a refused chat send exits 1 instead of printing a successful transcript", async () => {
  respondWith(
    {
      type: "about:blank",
      title: "Too Many Requests",
      status: 429,
      detail: "Request limit exceeded.",
    },
    429,
  )
  expect(await cli("--json", "chat", "--tenant", "customer", "--user", "user", "Hello")).toBe(1)
  expect(stdout).toBe("")
  expect(JSON.parse(stderr)).toMatchObject({
    error: { detail: "Request limit exceeded." },
    context,
  })
})

test("usage errors in JSON mode are JSON on stderr and exit 2", async () => {
  const usageError = async (...args: string[]) => {
    stderr = ""
    expect(await cli("--json", ...args)).toBe(2)
    return (JSON.parse(stderr) as { error: { detail: string } }).error.detail
  }

  expect(await usageError("tenant-users", "get", "user")).toMatch(/tenant-id/)
  expect(
    await usageError("token", "chat", "--tenant", "t", "--user", "u", "--expires-in", "59"),
  ).toMatch(/60 to 600/)
})

test("directory bindings and environment credentials resolve and verify the Organization", async () => {
  vi.stubEnv("ASTRALBEAM_API_KEY", undefined)
  const root = await realpath(await mkdtemp(join(tmpdir(), "astralbeam-cli-dirs-")))
  const nested = join(root, "acme", "app", "src")
  await mkdir(nested, { recursive: true })
  const organization = { id: ORGANIZATION_ID, name: "Acme", slug: "acme" }
  const savedApiUrl = "https://saved.test/api"
  await writeConfig({
    bindings: {
      [root]: { api_url: API_URL, api_key: "outer", organization: { ...organization, id: "x" } },
      [join(root, "acme")]: { api_url: savedApiUrl, api_key: API_KEY, organization },
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

  expect(String(fetch.mock.calls[0]?.[0])).toBe(`${API_URL}/v1/tenants`)
  expect((await readConfig()).bindings[join(root, "acme")]?.api_url).toBe(savedApiUrl)
  vi.stubEnv("ASTRALBEAM_API_URL", undefined)
  expect(await cli("tenants", "list")).toBe(0)
  expect(String(fetch.mock.calls.at(-1)?.[0])).toBe(`${savedApiUrl}/v1/tenants`)

  process.chdir(tmpdir())
  stderr = ""
  expect(await cli("--json", "tenants", "list")).toBe(1)
  expect(stderr).toMatch(/No AstralBeam login covers/)
  expect(fetch).toHaveBeenCalledTimes(2)

  process.chdir(nested)
  const environmentOrganization = { ...organization, id: "01990a5d-0000-7000-8000-000000000012" }
  vi.stubEnv("ASTRALBEAM_API_KEY", API_KEY.replace(ORGANIZATION_ID, environmentOrganization.id))
  respondWith(environmentOrganization)
  stderr = ""
  stdout = ""
  expect(await cli("--json", "auth", "status")).toBe(0)
  expect(JSON.parse(stdout)).toMatchObject({
    organization: environmentOrganization,
    source: "ASTRALBEAM_API_KEY",
  })
  expect(JSON.parse(stderr)).toEqual({
    context: { organization: environmentOrganization, bound_directory: null },
  })

  respondWith(organization)
  stderr = ""
  expect(await cli("--json", "auth", "status")).toBe(1)
  expect(JSON.parse(stderr)).toMatchObject({
    error: { detail: "The API returned a different organization." },
  })
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

test("missing config files and empty objects retain the empty-binding default", async () => {
  expect(await readConfig()).toEqual({ bindings: {} })
  await writeFile(configPath(), "{}")
  expect(await readConfig()).toEqual({ bindings: {} })
})

test.each([
  "null",
  "[]",
  '{"bindings":[]}',
  '{"bindings":null}',
  '{"bindings":{"/tmp":{"api_key":"private-key"}}}',
  '{"bindings": {"/tmp": "private-key"}}',
  '{"private-key":',
])("invalid saved bindings fail without leaking or rewriting the config", async (source) => {
  await writeFile(configPath(), source)
  expect(await cli("--json", "auth", "logout")).toBe(1)
  expect(JSON.parse(stderr)).toMatchObject({
    error: { detail: `Invalid AstralBeam login bindings in ${configPath()}` },
  })
  expect(stderr).not.toContain("private-key")
  expect(await readFile(configPath(), "utf8")).toBe(source)
})

test("the entry point keeps JSON stderr valid when color settings conflict", async () => {
  const result = await promisify(execFile)(
    "bun",
    ["run", join(import.meta.dirname, "main.ts"), "--json", "tenants", "list", "--help"],
    {
      cwd: tmpdir(),
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "1" },
    },
  )
  expect(JSON.parse(result.stderr)).toEqual({ context: null })
})
