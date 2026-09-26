import { describe, expect, it } from "vitest"
import { addIssue, editIssue } from "./model.ts"
import { initialData } from "./seed.ts"
import { readSavedData } from "./store.ts"

const data = initialData("00000000-0000-4000-8000-000000000001")
const workspace = data.workspaces[0]!
const other = data.workspaces[1]!
const issue = workspace.issues[0]!

describe("workspace mutations", () => {
  it("rejects issue and relationship IDs from another workspace", () => {
    expect(() => editIssue(workspace, other.issues[0]!.id, { status: "Done" })).toThrow(
      "active workspace",
    )
    expect(() => editIssue(workspace, issue.id, { assigneeId: other.members[0]!.id })).toThrow(
      "member",
    )
    expect(() => addIssue(workspace, { ...issue, projectId: other.projects[0]!.id })).toThrow(
      "project",
    )
  })
  it("keeps omitted fields and validates agent changes before applying them", () => {
    const updated = editIssue(workspace, issue.id, { status: "Done", assigneeId: null })
    expect(updated).toEqual({ ...issue, status: "Done", assigneeId: null })
    expect(issue.status).toBe("Todo")
    expect(() => editIssue(workspace, issue.id, { title: " " })).toThrow()
    expect(() => editIssue(workspace, issue.id, { status: "Invented" })).toThrow()
  })
  it("round-trips state and rejects broken persisted relationships", () => {
    expect(readSavedData(JSON.stringify(data))).toEqual(data)
    const invalid = structuredClone(data)
    invalid.workspaces[0]!.issues[0]!.projectId = other.projects[0]!.id
    expect(() => readSavedData(JSON.stringify(invalid))).toThrow("project")
  })
})
