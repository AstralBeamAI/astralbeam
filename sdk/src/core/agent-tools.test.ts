import { expect, test, vi } from "vitest"
import { buildAgentTools } from "./agent-tools.ts"

test("invalid host results identify the completed tool and warn against retrying its mutation", async () => {
  const execute = vi.fn(() => ({ issue: { title: "Already created", optional: undefined } }))
  const tool = buildAgentTools(
    {},
    { create_issue: { description: "Create an issue", execute } },
    () => Promise.resolve({ widget: "unused", rendered: false }),
  ).find((entry) => entry.name === "create_issue")!

  await expect(tool.execute!({})).rejects.toThrow(
    'Tool "create_issue" ran, but its result is not JSON-compatible. Its changes may already be applied. Read current state before retrying.',
  )
  expect(execute).toHaveBeenCalledTimes(1)
})

test("JSON-compatible host results retain their values", async () => {
  const result = { id: "issue-1", assignee: null, completed: false, labels: ["launch"], count: 0 }
  const tool = buildAgentTools(
    {},
    { get_issue: { description: "Read an issue", execute: () => result } },
    () => Promise.resolve({ widget: "unused", rendered: false }),
  ).find((entry) => entry.name === "get_issue")!

  await expect(tool.execute!({})).resolves.toEqual(result)
})
