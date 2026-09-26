import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createWorkspaceTools } from "./astro-tools.ts"
import { demoWorkspaces } from "./model.ts"
import { workspaceUrl } from "./navigation.ts"
import { demoStore } from "./store.ts"

beforeEach(() => {
  vi.stubGlobal("localStorage", { setItem: vi.fn() })
  demoStore.reset()
})
afterEach(() => vi.unstubAllGlobals())

it("returns JSON-compatible context, including no undefined fields", async () => {
  const result = await createWorkspaceTools(demoWorkspaces[0].id, {
    current: () => "/",
    go: async () => {},
  }).inspect_workspace.execute({})
  expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
})

it("makes consecutive tool changes readable immediately and rejects a stale workspace", async () => {
  const tools = createWorkspaceTools(demoWorkspaces[0].id, {
    current: () => "/",
    go: async () => {},
  })
  const workspace = demoStore.workspace(demoWorkspaces[0].id)
  await tools.create_issue.execute({
    title: "Plan the launch",
    description: "Review release criteria",
    status: "Todo",
    priority: "High",
    label: "Feature",
    assigneeId: null,
    projectId: workspace.projects[0]!.id,
    cycle: "Cycle 24",
  })
  const created = demoStore
    .workspace(workspace.id)
    .issues.find((issue) => issue.title === "Plan the launch")!
  await tools.update_issue.execute({ id: created.id, changes: { status: "In progress" } })
  const issues = await tools.list_issues.execute({ query: "Plan the launch" })
  expect(issues).toEqual([
    { ...created, status: "In progress", url: workspaceUrl(workspace.id, `issues/${created.id}`) },
  ])
  demoStore.switchWorkspace(demoWorkspaces[1].id)
  expect(() => tools.update_issue.execute({ id: created.id, changes: { status: "Done" } })).toThrow(
    "workspace changed",
  )
})

it("navigates only to existing destinations in the active workspace", async () => {
  const workspace = demoStore.workspace(demoWorkspaces[0].id)
  let current = workspaceUrl(workspace.id, "overview")
  const go = vi.fn((url: string) => {
    current = url
    return Promise.resolve()
  })
  const tools = createWorkspaceTools(workspace.id, { current: () => current, go })
  const url = workspaceUrl(workspace.id, `issues/${workspace.issues[0]!.id}`)
  await expect(tools.navigate_app.execute({ url })).resolves.toEqual({ url, opened: true })
  for (const invalid of [
    "https://example.com",
    "//example.com",
    workspaceUrl(demoWorkspaces[1].id, "issues"),
    workspaceUrl(workspace.id, "issues/missing"),
    `/${workspace.id}/../${demoWorkspaces[1].id}/overview`,
  ]) {
    await expect(tools.navigate_app.execute({ url: invalid })).rejects.toThrow()
  }
  expect(go).toHaveBeenCalledTimes(1)
  demoStore.switchWorkspace(demoWorkspaces[1].id)
  await expect(tools.navigate_app.execute({ url })).rejects.toThrow("workspace changed")
})

it("finds a customer mentioned in the issue description", async () => {
  const tools = createWorkspaceTools(demoWorkspaces[0].id, {
    current: () => "/",
    go: () => Promise.resolve(),
  })
  const issues = await tools.list_issues.execute({ query: "Atlas SSO" })
  expect(issues).toEqual([expect.objectContaining({ number: 128 })])
})
