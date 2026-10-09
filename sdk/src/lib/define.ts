import type {
  InferParameters,
  JsonSchemaObject,
  ParametersSchema,
  ToolDefinition,
  ToolResult,
  ToolContent,
  StandardSchemaV1,
  ToolRegistry,
  WidgetContext,
  WidgetDefinition,
  WidgetRenderHandle,
} from "./types.ts"

export type ExplicitToolResult<Output = object> = ToolResult<Output> & {
  readonly [Symbol.toStringTag]: "AstralBeam.ToolResult"
}

type OutputData<S extends ParametersSchema> =
  S extends StandardSchemaV1<unknown, infer Output> ? Output : object

export interface TypedToolDefinition<
  Input extends ParametersSchema = JsonSchemaObject,
  Output extends ParametersSchema = JsonSchemaObject,
  Result extends OutputData<Output> | ExplicitToolResult<OutputData<Output>> =
    | OutputData<Output>
    | ExplicitToolResult<OutputData<Output>>,
> extends Omit<ToolDefinition, "parameters" | "outputSchema" | "execute"> {
  parameters?: Input
  outputSchema?: Output
  execute: (
    input: InferParameters<Input>,
    context: Parameters<ToolDefinition["execute"]>[1],
  ) => Result | Promise<Result>
}

export interface TypedWidgetDefinition<
  S extends ParametersSchema = JsonSchemaObject,
  Tools extends ToolRegistry = ToolRegistry,
> extends Omit<WidgetDefinition, "parameters" | "render"> {
  parameters?: S
  /** Optional registry for inferred callTool names, inputs and results. */
  tools?: Tools
  render: (
    props: InferParameters<S>,
    container: HTMLElement,
    context: WidgetContext<InferParameters<S>, Tools>,
  ) => WidgetRenderHandle<InferParameters<S>, Tools> | (() => void) | void
}

export function defineTool<
  const Input extends ParametersSchema = JsonSchemaObject,
  const Output extends ParametersSchema = JsonSchemaObject,
  Result extends OutputData<Output> | ExplicitToolResult<OutputData<Output>> =
    | OutputData<Output>
    | ExplicitToolResult<OutputData<Output>>,
>(tool: TypedToolDefinition<Input, Output, Result>): TypedToolDefinition<Input, Output, Result> {
  return tool
}

export function defineWidget<
  const S extends ParametersSchema = JsonSchemaObject,
  const Tools extends ToolRegistry = ToolRegistry,
>(widget: TypedWidgetDefinition<S, Tools>): TypedWidgetDefinition<S, Tools> {
  return widget
}

type ToolResultOptions = Omit<ToolResult<object>, "content"> & {
  content?: string | readonly ToolContent[]
}

/** Marks a custom envelope, expanding text and supplying a structured-data fallback. */
export function toolResult<const Result extends ToolResultOptions>(
  result: Result,
): Omit<Result, "content"> & Pick<ExplicitToolResult, "content" | typeof Symbol.toStringTag> {
  const content =
    typeof result.content === "string"
      ? [{ type: "text", text: result.content }]
      : (result.content ??
        (result.structuredContent === undefined
          ? []
          : [{ type: "text", text: JSON.stringify(result.structuredContent) }]))
  return { ...result, content, [Symbol.toStringTag]: "AstralBeam.ToolResult" }
}
