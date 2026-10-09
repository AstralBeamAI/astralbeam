import { expect, expectTypeOf, test } from "vitest"
import { defineTool, defineWidget, toolResult } from "./define.ts"
import { defineWidget as defineReactWidget } from "../react/index.tsx"
import type { StandardSchemaV1, ToolInput, ToolRegistry, WidgetRegistry } from "./types.ts"

test("definitions retain transformed input and inferred result types through widget calls", () => {
  const parameters: StandardSchemaV1<{ id: string }, { id: number }> = {
    "~standard": { version: 1, vendor: "test", validate: () => ({ value: { id: 1 } }) },
  }
  const tools = {
    lookup: defineTool({
      description: "Read",
      parameters,
      execute: ({ id }) => {
        expectTypeOf(id).toEqualTypeOf<number>()
        return { id }
      },
    }),
  } satisfies ToolRegistry
  expectTypeOf<ToolInput<typeof tools.lookup>>().toEqualTypeOf<{ id: string }>()
  const render = defineReactWidget({
    description: "Card",
    parameters,
    tools,
    render: (props, { input, callTool }) => {
      expectTypeOf(props.id).toEqualTypeOf<number>()
      expectTypeOf(input.id).toEqualTypeOf<number>()
      expectTypeOf(callTool<"lookup">)
        .parameter(0)
        .toEqualTypeOf<"lookup">()
      expectTypeOf(callTool("lookup", { id: "1" })).toEqualTypeOf<Promise<{ id: number }>>()
      return null
    },
  })
  const widgets = {
    card: defineWidget({
      description: "Card",
      parameters,
      tools,
      render: ({ id }, container, { callTool }) => {
        expectTypeOf(id).toEqualTypeOf<number>()
        expectTypeOf(container).toEqualTypeOf<HTMLElement>()
        expectTypeOf(callTool<"lookup">)
          .parameter(0)
          .toEqualTypeOf<"lookup">()
        return {
          update: ({ input, callTool }) => {
            expectTypeOf(input.id).toEqualTypeOf<number>()
            expectTypeOf(callTool<"lookup">)
              .parameter(0)
              .toEqualTypeOf<"lookup">()
          },
          dispose: () => {},
        }
      },
    }),
  } satisfies WidgetRegistry
  expectTypeOf(render.tools).toEqualTypeOf<typeof tools | undefined>()
  expectTypeOf(widgets.card.tools).toEqualTypeOf<typeof tools | undefined>()
  expect(
    tools.lookup.execute({ id: 1 }, { signal: new AbortController().signal, invocationId: "test" }),
  ).toEqual({ id: 1 })
})

test("domain interfaces and custom envelopes retain their types without index signatures", () => {
  interface Todo {
    id: number
    text: string
  }
  const todo: Todo = { id: 1, text: "Ship" }
  const outputSchema: StandardSchemaV1<unknown, Todo> = {
    "~standard": { version: 1, vendor: "test", validate: () => ({ value: todo }) },
  }
  const tools = {
    get: defineTool({ description: "Read", outputSchema, execute: () => todo }),
    missing: defineTool({
      description: "Missing",
      outputSchema,
      execute: () => toolResult({ content: "Not found", isError: true }),
    }),
  } satisfies ToolRegistry
  defineWidget({
    description: "Card",
    tools,
    render: (_props, _container, { callTool }) => {
      expectTypeOf(callTool("get")).toEqualTypeOf<Promise<Todo>>()
      expectTypeOf(callTool("missing")).toEqualTypeOf<
        Promise<Awaited<ReturnType<typeof tools.missing.execute>>>
      >()
    },
  })
  expect(
    tools.missing.execute({}, { signal: new AbortController().signal, invocationId: "test" }),
  ).toMatchObject({ isError: true })
})
