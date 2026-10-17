import { expect, expectTypeOf, test } from "vitest"
import { defineTool, defineWidget } from "./define.ts"
import { defineWidget as defineReactWidget } from "../react/index.tsx"
import type { StandardSchemaV1, ToolInput, ToolRegistry } from "./types.ts"

test("schema helpers preserve transformed inputs, domain arrays and widget call types", () => {
  interface Item {
    id: number
  }
  const parameters: StandardSchemaV1<{ id: string }, { id: number }> = {
    "~standard": { version: 1, vendor: "test", validate: () => ({ value: { id: 1 } }) },
  }
  const outputSchema: StandardSchemaV1<unknown, Item[]> = {
    "~standard": { version: 1, vendor: "test", validate: () => ({ value: [] }) },
  }
  const tools = {
    lookup: defineTool({
      description: "Lookup",
      parameters,
      outputSchema,
      execute: ({ id }): Item[] => {
        expectTypeOf(id).toEqualTypeOf<number>()
        return [{ id }]
      },
    }),
  } satisfies ToolRegistry
  expectTypeOf<ToolInput<typeof tools.lookup>>().toEqualTypeOf<{ id: string }>()
  defineReactWidget({
    description: "React card",
    parameters,
    tools,
    render: (_props, { input, callTool }) => {
      expectTypeOf(input.id).toEqualTypeOf<number>()
      expectTypeOf(callTool("lookup", { id: "1" })).toEqualTypeOf<Promise<Item[]>>()
      return null
    },
  })
  defineWidget({
    description: "Native card",
    parameters,
    tools,
    render: (_props, _container, _context) => ({
      update: ({ input, callTool }) => {
        expectTypeOf(input.id).toEqualTypeOf<number>()
        expectTypeOf(callTool("lookup", { id: "1" })).toEqualTypeOf<Promise<Item[]>>()
      },
      dispose: () => {},
    }),
  })
  expect(tools.lookup.execute({ id: 1 })).toEqual([{ id: 1 }])
})
