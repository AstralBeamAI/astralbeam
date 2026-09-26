import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createWorkspaceTools } from "./astro-tools.ts"
import { demoWorkspaces } from "./model.ts"
import { demoStore } from "./store.ts"

beforeEach(() => {
  vi.stubGlobal("localStorage", { setItem: vi.fn() })
  demoStore.reset()
})
afterEach(() => vi.unstubAllGlobals())

it("returns JSON-compatible context, including no undefined fields", async () => {
  const result = await createWorkspaceTools(demoWorkspaces[0].id).inspect_workspace.execute({})
  expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
})

it("makes consecutive tool changes readable immediately and rejects a stale workspace", async () => {
  const tools = createWorkspaceTools(demoWorkspaces[0].id)
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
  expect(issues).toEqual([{ ...created, status: "In progress" }])
  demoStore.switchWorkspace(demoWorkspaces[1].id)
  expect(() => tools.update_issue.execute({ id: created.id, changes: { status: "Done" } })).toThrow(
    "workspace changed",
  )
})
