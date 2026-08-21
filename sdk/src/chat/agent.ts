import { type SchemaInput, toolDefinition } from "@tanstack/ai/client"
import type {
  JsonSchemaObject,
  ToolDefinition as HostToolDefinition,
  WidgetDefinition,
} from "../client.ts"
import { ASK_QUESTIONNAIRE_TOOL, RENDER_WIDGET_TOOL } from "../lib/constants.ts"
import type { DebugLogger } from "../lib/debug.ts"
import type { RenderWidgetInput } from "../lib/types.ts"
import { toJsonSchema, validateParameters } from "../lib/utils.ts"

// Declares the registered widgets to the agent as one `render_widget` tool whose
// description carries the per-widget catalog; `render` is the chat widget's DOM side.
export function buildRenderWidgetTool(
  widgets: Record<string, WidgetDefinition>,
  render: (
    input: RenderWidgetInput,
    toolCallId: string,
  ) => Promise<{ widget: string; rendered: boolean }>,
) {
  const catalog = Object.entries(widgets).map(([name, { description, parameters }]) =>
    `- ${name}: ${description} Props schema: ${JSON.stringify(toJsonSchema(parameters))}`
  ).join("\n")
  return toolDefinition({
    name: RENDER_WIDGET_TOOL,
    description: "Render one of the host application's own UI widgets inline in the " +
      "conversation. The widget appears in the transcript at the point of the call, so prefer " +
      "it over describing the same information in text. Available widgets:\n" + catalog,
    inputSchema: {
      type: "object",
      properties: {
        widget: {
          type: "string",
          enum: Object.keys(widgets),
          description: "Name of the widget to render.",
        },
        props: {
          type: "object",
          description: "Props for the widget, matching its props schema.",
        },
      },
      required: ["widget"],
    } satisfies JsonSchemaObject,
  }).client((input, context) => render(input as RenderWidgetInput, context?.toolCallId ?? ""))
}

// Declared without an execute function on purpose: the call stays pending while the
// questionnaire renders, and the user's submission resolves it through `addToolResult`.
export function buildAskQuestionnaireTool() {
  return toolDefinition({
    name: ASK_QUESTIONNAIRE_TOOL,
    description: "Ask the user a short structured questionnaire rendered inline in the chat. " +
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

/** Wraps the host's mount-time tools as client tools the agent can call. */
export function buildHostTools(tools: Record<string, HostToolDefinition>, debug?: DebugLogger) {
  return Object.entries(tools).map(([name, tool]) =>
    toolDefinition({
      name,
      description: tool.description,
      inputSchema: toJsonSchema(tool.parameters) as SchemaInput,
    }).client(async (input) => {
      debug?.("tool", `executing host tool "${name}"`, { input })
      const validated = await validateParameters(
        tool.parameters,
        (input ?? {}) as Record<string, unknown>,
      )
      if (validated == null) {
        debug?.("error", `input for host tool "${name}" failed schema validation`, { input })
        throw new Error(`Input for tool "${name}" failed schema validation`)
      }
      try {
        const output = await tool.execute(validated)
        debug?.("tool", `host tool "${name}" returned`, { output })
        return output
      } catch (error) {
        debug?.("error", `host tool "${name}" threw`, { error })
        throw error
      }
    })
  )
}
