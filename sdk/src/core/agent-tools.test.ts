import { expect, test, vi } from "vitest"
import { buildAgentTools, executeHostTool } from "./agent-tools.ts"
import { toolResult } from "../lib/define.ts"

const context = () => ({ signal: new AbortController().signal, invocationId: "call" })

test("plain objects become structured results without reserving business field names", async () => {
  const data = {
    content: "Article body",
    structuredContent: { nested: true },
    uiData: { label: "Business data" },
    isError: true,
  }
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

test("invalid results warn against retrying a completed mutation", async () => {
  const execute = vi.fn(() => ({ optional: undefined }))
  await expect(
    executeHostTool({ name: "create_issue", description: "Create", execute }, {}, context()),
  ).rejects.toThrow("Its changes may already be applied")
  expect(execute).toHaveBeenCalledTimes(1)
})

test("validates JSON inputs and structured outputs while preserving UI data", async () => {
  const result = {
    content: [{ type: "text", text: "Found" }],
    structuredContent: { id: "issue-1" },
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
    outputSchema: schema,
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
    executeHostTool({ ...tool, execute: () => ({ id: 1 }) }, { id: "issue-1" }, context()),
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

test("cancellation prevents execution and supplies invocation context", async () => {
  const execute = vi.fn(() => ({}))
  const tool = { name: "change", description: "Change", execute }
  const controller = new AbortController()
  controller.abort()
  await expect(
    executeHostTool(tool, {}, { signal: controller.signal, invocationId: "cancelled" }),
  ).rejects.toThrow()
  expect(execute).not.toHaveBeenCalled()
  const invocation = context()
  await executeHostTool(tool, {}, invocation)
  expect(execute).toHaveBeenCalledWith({}, invocation)
})

test("structured output uses the exported output contract without rerunning input transforms", async () => {
  const validate = vi.fn(() => ({ issues: [{ message: "Expected pre-transform input" }] }))
  const outputSchema = {
    "~standard": {
      version: 1 as const,
      vendor: "transforming-schema",
      validate,
      jsonSchema: {
        input: () => ({ type: "object", properties: { count: { type: "string" } } }),
        output: () => ({
          type: "object",
          properties: { count: { type: "number" } },
          required: ["count"],
        }),
      },
    },
  }
  const tool = {
    name: "count",
    description: "Count",
    outputSchema,
    execute: () => ({ count: 2 }),
  }
  await expect(executeHostTool(tool, {}, context())).resolves.toMatchObject({
    result: { structuredContent: { count: 2 } },
  })
  expect(validate).not.toHaveBeenCalled()
  await expect(
    executeHostTool({ ...tool, execute: () => ({ count: "2" }) }, {}, context()),
  ).rejects.toThrow("output validation")
})

test("widget tools expose their actual schema and duplicate registries fail closed", () => {
  const schema = {
    type: "object" as const,
    properties: { id: { type: "string" } },
    required: ["id"],
  }
  const widget = { description: "Card", parameters: schema }
  const render = vi.fn(() => Promise.resolve({ widget: "card", rendered: true }))
  const tools = buildAgentTools({ card: widget }, {}, render)
  expect(tools.find((tool) => tool.name === "show_card")?.inputSchema).toEqual(schema)
  expect(() =>
    buildAgentTools(
      { card: widget },
      { show_card: { description: "Collision", execute: () => ({}) } },
      render,
    ),
  ).toThrow("Duplicate")
  expect(
    buildAgentTools(
      {},
      {
        private: {
          description: "UI action",
          visibility: ["app"],
          execute: () => ({}),
        },
      },
      render,
    ).map((tool) => tool.name),
  ).not.toContain("private")
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
