import { expect, expectTypeOf, test } from "vitest"
import { defineTool, defineWidget, toolResult } from "./define.ts"
import { defineWidget as defineReactWidget } from "../react/index.tsx"
import type { StandardSchemaV1, ToolInput, ToolRegistry, WidgetRegistry } from "./types.ts"

test("definitions retain transformed input and inferred result types through widget calls", () => {
  interface Item {
    id: number
  }
  const parameters: StandardSchemaV1<{ id: string }, { id: number }> = {
    "~standard": { version: 1, vendor: "test", validate: () => ({ value: { id: 1 } }) },
  }
  const outputSchema: StandardSchemaV1<unknown, Item> = {
    "~standard": { version: 1, vendor: "test", validate: () => ({ value: { id: 1 } }) },
  }
  const tools = {
    lookup: defineTool({
      description: "Read",
      parameters,
      outputSchema,
      execute: ({ id }): Item => {
        expectTypeOf(id).toEqualTypeOf<number>()
        return { id }
      },
    }),
    missing: defineTool({
      description: "Missing",
      outputSchema,
      execute: () => toolResult({ content: "Not found", isError: true }),
    }),
  } satisfies ToolRegistry
  expectTypeOf<ToolInput<typeof tools.lookup>>().toEqualTypeOf<{ id: string }>()
  defineReactWidget({
    description: "Card",
    parameters,
    tools,
    render: (_props, { input, callTool }) => {
      expectTypeOf(input.id).toEqualTypeOf<number>()
      expectTypeOf(callTool("lookup", { id: "1" })).toEqualTypeOf<Promise<Item>>()
      return null
    },
  })
  const widgets = {
    card: defineWidget({
      description: "Card",
      parameters,
      tools,
      render: ({ id }, container, _context) => {
        expectTypeOf(id).toEqualTypeOf<number>()
        expectTypeOf(container).toEqualTypeOf<HTMLElement>()
        return {
          update: ({ input, callTool }) => {
            expectTypeOf(input.id).toEqualTypeOf<number>()
            expectTypeOf(callTool("missing")).toEqualTypeOf<
              Promise<Awaited<ReturnType<typeof tools.missing.execute>>>
            >()
          },
          dispose: () => {},
        }
      },
    }),
  } satisfies WidgetRegistry
  expectTypeOf(widgets.card.tools).toEqualTypeOf<typeof tools | undefined>()
  expect(
    tools.missing.execute({}, { signal: new AbortController().signal, invocationId: "test" }),
  ).toMatchObject({ content: [{ type: "text", text: "Not found" }], isError: true })
})
