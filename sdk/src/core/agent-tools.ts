import { canonicalInterruptJson, type SchemaInput, toolDefinition } from "@tanstack/ai/client"
import type {
  JsonSchemaObject,
  ToolDefinition as HostToolDefinition,
  WidgetDefinition,
  ToolResult,
  ToolExecutionContext,
  WidgetContext,
  ToolRegistry,
} from "../lib/types.ts"
import type { DebugLogger } from "../lib/debug.ts"
import { toolResult } from "../lib/define.ts"
import { ASK_QUESTIONNAIRE_TOOL, RENDER_WIDGET_TOOL } from "./protocol.ts"
import type { RenderWidgetInput } from "./types.ts"
import {
  toJsonSchema,
  compileJsonSchema,
  validateParameters,
  validateToolResult,
} from "./schema.ts"

type RenderWidget = (
  input: RenderWidgetInput,
  toolCallId: string,
  result?: ToolResult,
  status?: WidgetContext["status"],
) => Promise<{ widget: string; rendered: boolean }>

export type WidgetDeclaration = Pick<WidgetDefinition, "description" | "parameters">
type NamedTool = HostToolDefinition & { name: string }

export function buildAgentTools(
  widgets: Readonly<Record<string, WidgetDeclaration>>,
  hostTools: ToolRegistry,
  renderWidget: RenderWidget,
  debug?: DebugLogger,
) {
  const registry = new Map<string, { tool: NamedTool; presentation: boolean }>()
  const register = (tool: NamedTool, presentation = false) => {
    // Match WebMCP names. https://webmachinelearning.github.io/webmcp/#dom-modelcontext-registertool
    if (
      !/^[\w.-]{1,128}$/.test(tool.name) ||
      registry.has(tool.name) ||
      [ASK_QUESTIONNAIRE_TOOL, RENDER_WIDGET_TOOL].includes(tool.name)
    )
      throw new Error(`Duplicate, reserved or invalid tool name "${tool.name}"`)
    if (tool.widget !== undefined && !Object.hasOwn(widgets, tool.widget))
      throw new Error(`Unknown widget "${tool.widget}"`)
    const inputSchema = toJsonSchema(tool.parameters)
    if (!tool.parameters || !("~standard" in tool.parameters)) compileJsonSchema(inputSchema)
    if (tool.outputSchema) compileJsonSchema(toJsonSchema(tool.outputSchema, "output"))
    registry.set(tool.name, { tool, presentation })
  }
  for (const [name, tool] of Object.entries(hostTools)) register({ ...tool, name })
  for (const [id, widget] of Object.entries(widgets)) {
    if (!id) throw new Error("A widget ID cannot be empty")
    register(
      {
        name: `show_${id}`,
        description: widget.description,
        ...(widget.parameters ? { parameters: widget.parameters } : {}),
        widget: id,
        annotations: { readOnlyHint: true },
        execute: () => toolResult({ content: `Displayed ${id}` }),
      },
      true,
    )
  }
  return [
    buildAskQuestionnaireTool(),
    ...[...registry.values()]
      .filter(({ tool }) => !tool.visibility || tool.visibility.includes("model"))
      .map(({ tool, presentation }) => buildHostTool(tool, presentation, renderWidget, debug)),
  ]
}

// Declared without an execute function on purpose: the call stays pending while the
// questionnaire renders, and the user's submission resolves it through `addToolResult`.
function buildAskQuestionnaireTool() {
  return toolDefinition({
    name: ASK_QUESTIONNAIRE_TOOL,
    description:
      "Ask the user a short structured questionnaire rendered inline in the chat. " +
      "Use it when the next step genuinely depends on their choices instead of asking in prose. " +
      "The call stays pending until the user submits; their answers arrive as the tool output. " +
      "Skipped optional questions come back with an empty answers array. An output with " +
      "skipped: true means the user dismissed the questionnaire by continuing the conversation " +
      "instead — do not re-ask; address their next message.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          description: "Questions shown one at a time, in order.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Unique key identifying the question." },
              title: { type: "string", description: "The question itself." },
              description: { type: "string", description: "Optional helper text." },
              required: { type: "boolean", description: "Whether an answer is mandatory." },
              multiple: {
                type: "boolean",
                description: "Whether several choices may be selected.",
              },
              choices: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  properties: {
                    value: { type: "string" },
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["value", "label"],
                },
              },
              input: {
                type: "object",
                description: "Optional free-form alternative to the fixed choices.",
                properties: {
                  label: { type: "string" },
                  placeholder: { type: "string" },
                },
                required: ["label", "placeholder"],
              },
            },
            required: ["name", "title", "choices"],
          },
        },
      },
      required: ["items"],
    } satisfies JsonSchemaObject,
  }).client()
}

/** Shared validation for assistant calls and widget-initiated application calls. */
export async function executeHostTool(
  tool: NamedTool,
  input: unknown,
  context: ToolExecutionContext,
  onValidated?: () => Promise<void>,
) {
  context.signal.throwIfAborted()
  const outputSchema = tool.outputSchema
    ? compileJsonSchema(toJsonSchema(tool.outputSchema, "output"))
    : undefined
  const validated = await validateParameters(tool.parameters, input ?? {})
  if (validated === null) throw new Error(`Input for tool "${tool.name}" failed schema validation`)
  context.signal.throwIfAborted()
  await onValidated?.()
  context.signal.throwIfAborted()
  const output = await tool.execute(validated, context)
  try {
    canonicalInterruptJson(output)
    return { result: validateToolResult(output, outputSchema), value: output }
  } catch {
    throw new Error(
      `Tool "${tool.name}" ran, but its result failed JSON or output validation. Its changes may already be applied. Read current state before retrying.`,
    )
  }
}

function buildHostTool(
  tool: NamedTool,
  presentation: boolean,
  render: RenderWidget,
  debug?: DebugLogger,
) {
  const structuredSchema = tool.outputSchema ? toJsonSchema(tool.outputSchema, "output") : undefined
  return toolDefinition({
    name: tool.name,
    description: tool.description,
    inputSchema: toJsonSchema(tool.parameters) as SchemaInput,
    metadata: {
      ...(tool.title ? { title: tool.title } : {}),
      astralbeam: {
        resultVersion: 1,
        ...(tool.widget ? { widget: tool.widget } : {}),
        ...(structuredSchema ? { outputSchema: structuredSchema } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        visibility: tool.visibility ?? ["model", "app"],
        presentation,
      },
    },
  }).client(async (input: unknown, context) => {
    const toolCallId = context?.toolCallId ?? ""
    const signal = context?.abortSignal ?? new AbortController().signal
    // Presentation failures must not turn a completed business operation into a retry.
    const present = async (result: ToolResult | undefined, status: WidgetContext["status"]) => {
      if (!tool.widget) return false
      try {
        const { rendered } = await render(
          { widget: tool.widget, props: (input ?? {}) as Record<string, unknown> },
          toolCallId,
          result,
          status,
        )
        return rendered
      } catch (error) {
        debug?.("error", "Widget presentation failed", error)
        return false
      }
    }
    const cancelled = () => {
      void present(undefined, "cancelled")
    }
    signal.addEventListener("abort", cancelled, { once: true })
    try {
      debug?.("tool", `executing host tool "${tool.name}"`, { input })
      const { result: output } = await executeHostTool(
        tool,
        input,
        { signal, invocationId: toolCallId },
        async () => {
          if (!presentation) await present(undefined, "pending")
        },
      )
      debug?.("tool", `host tool "${tool.name}" returned`, { output })
      const rendered = await present(
        output,
        signal.aborted ? "cancelled" : output.isError ? "error" : "complete",
      )
      if (presentation && !rendered)
        return {
          content: [{ type: "text", text: `Could not display ${tool.widget}` }],
          isError: true,
        }
      return output
    } catch (error) {
      debug?.("error", `host tool "${tool.name}" threw`, { error })
      await present(undefined, signal.aborted ? "cancelled" : "error")
      throw error
    } finally {
      signal.removeEventListener("abort", cancelled)
    }
  })
}
