import { expect, test, vi } from "vitest"
import { buildAgentTools, executeHostTool } from "./agent-tools.ts"
import { toolResult } from "../lib/define.ts"

const context = () => ({ signal: new AbortController().signal, invocationId: "call" })

test("invalid results warn against retrying a completed mutation", async () => {
  const execute = vi.fn(() => ({ optional: undefined }))
  const tool = buildAgentTools(
    {},
    { create_issue: { description: "Create", execute } },
    vi.fn(),
  ).find((entry) => entry.name === "create_issue")!
  await expect(tool.execute!({}, { toolCallId: "call", emitCustomEvent: vi.fn() })).rejects.toThrow(
    "Its changes may already be applied",
  )
  expect(execute).toHaveBeenCalledTimes(1)
})

test.each([
  { data: { content: "Business data", structuredContent: {}, uiData: {}, isError: true } },
  { data: ["first"] },
])("envelopes JSON output without reserving business fields: $data", async ({ data }) => {
  const { result, value } = await executeHostTool(
    { name: "read", description: "Read", execute: () => data },
    {},
    context(),
  )
  expect(result).toEqual({
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  })
  expect(value).toBe(data)
})

test("validates JSON inputs and structured outputs while preserving UI data", async () => {
  const result = {
    content: [{ type: "text", text: "Found" }],
    structuredContent: [{ id: "issue-1" }],
    uiData: { privateLabel: "UI only" },
  }
  const execute = vi.fn(() => toolResult(result))
  const schema = {
    type: "object" as const,
    properties: { id: { type: "string", pattern: "^issue-\\d+$" } },
    required: ["id"],
    additionalProperties: false,
  }
  const tool = {
    name: "get_issue",
    description: "Read",
    parameters: schema,
    outputSchema: { type: "array", items: schema },
    execute,
  }
  await expect(executeHostTool(tool, { id: "invalid" }, context())).rejects.toThrow(
    "schema validation",
  )
  expect(execute).not.toHaveBeenCalled()
  await expect(executeHostTool(tool, { id: "issue-1" }, context())).resolves.toEqual({
    result,
    value: toolResult(result),
  })
  await expect(
    executeHostTool({ ...tool, execute: () => [{ id: 1 }] }, { id: "issue-1" }, context()),
  ).rejects.toThrow("output validation")
  await expect(
    executeHostTool(
      {
        ...tool,
        execute: () => toolResult({ content: "Missing", isError: true }),
      },
      { id: "issue-1" },
      context(),
    ),
  ).resolves.toMatchObject({
    result: { content: [{ type: "text", text: "Missing" }], isError: true },
  })
})

test("presentation failure does not turn a completed business action into a retry", async () => {
  const render = vi.fn(() => {
    throw new Error("Render failed")
  })
  const tools = buildAgentTools(
    { card: { description: "Card" } },
    { change: { description: "Change", widget: "card", execute: () => ({ changed: true }) } },
    render,
  )
  const invocation = { toolCallId: "call", emitCustomEvent: vi.fn() }
  await expect(
    tools.find((tool) => tool.name === "show_card")!.execute!({}, invocation),
  ).resolves.toMatchObject({ isError: true })
  await expect(
    tools.find((tool) => tool.name === "change")!.execute!({}, invocation),
  ).resolves.toMatchObject({ structuredContent: { changed: true } })
})
