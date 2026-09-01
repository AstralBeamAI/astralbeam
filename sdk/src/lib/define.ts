// Identity helpers that exist for their generics: with a Standard Schema in `parameters`, the
// `execute`/`render` input is the schema's own output type instead of Record<string, unknown>.
import type {
  InferParameters,
  JsonSchemaObject,
  ParametersSchema,
  ToolDefinition,
  WidgetDefinition,
} from "./types.ts"

export interface TypedToolDefinition<S extends ParametersSchema = JsonSchemaObject> {
  description: string
  metadata?: Record<string, unknown> | undefined
  parameters?: S
  execute: (input: InferParameters<S>) => unknown | Promise<unknown>
}

export interface TypedWidgetDefinition<S extends ParametersSchema = JsonSchemaObject> {
  description: string
  parameters?: S
  render: (props: InferParameters<S>, container: HTMLElement) => (() => void) | void
}

/** Declares a host tool; a Standard Schema `parameters` types (and validates) `execute`'s input. */
export function defineTool<const S extends ParametersSchema = JsonSchemaObject>(
  tool: TypedToolDefinition<S>,
): ToolDefinition {
  // The widget validates a Standard Schema before execute runs, so the narrowed type holds.
  return tool as unknown as ToolDefinition
}

/** Declares a host widget; a Standard Schema `parameters` types (and validates) `render`'s props. */
export function defineWidget<const S extends ParametersSchema = JsonSchemaObject>(
  widget: TypedWidgetDefinition<S>,
): WidgetDefinition {
  return widget as unknown as WidgetDefinition
}
