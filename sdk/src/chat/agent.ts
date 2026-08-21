import { convertSchemaToJsonSchema, type SchemaInput, toolDefinition } from "@tanstack/ai/client"
import type { UIMessage } from "@tanstack/ai-client"
import type {
  JsonSchemaObject,
  ParametersSchema,
  StandardSchemaV1,
  ToolDefinition as HostToolDefinition,
  WidgetDefinition,
} from "../client.ts"

/**
 * Client tools every chat mount declares to the agent: the endpoint forwards them to the model
 * verbatim, the model calls them, and the chat widget executes them in the host page.
 */
export const RENDER_WIDGET_TOOL = "render_widget"
export const ASK_QUESTIONNAIRE_TOOL = "ask_questionnaire"

export interface RenderWidgetInput {
  /** Key into the `widgets` object passed at mount. */
  widget: string
  props?: Record<string, unknown>
}

interface QuestionnaireChoiceSpec {
  value: string
  label: string
  description?: string
}

export interface QuestionnaireItemSpec {
  name: string
  title: string
  description?: string
  required?: boolean
  multiple?: boolean
  choices: QuestionnaireChoiceSpec[]
  input?: { label: string; placeholder: string }
}

export interface QuestionnaireInput {
  items: QuestionnaireItemSpec[]
}

/** One submitted questionnaire answer, returned to the agent as part of the tool output. */
export interface QuestionnaireAnswer {
  name: string
  question: string
  answers: string[]
}

export function slotNameForWidget(widget: string): string {
  return `astralbeam-widget-${widget}`
}

export function getMessageText(message: UIMessage): string {
  return message.parts.map((part) => part.type === "text" ? part.content : "").join("")
}

/**
 * JSON Schema the agent sees for host-declared `parameters`. Plain JSON Schemas pass through;
 * Standard Schemas convert when the library exposes Standard JSON Schema (Zod v4+, ArkType);
 * validate-only Standard Schemas fall back to an open object, with validation still running
 * client-side through `validateParameters`.
 */
function toJsonSchema(parameters?: ParametersSchema): JsonSchemaObject {
  if (!parameters) return { type: "object" }
  if (!("~standard" in parameters)) return parameters
  try {
    // The SDK's vendored schema types and TanStack's SchemaInput are structurally interchangeable
    // here; the cast bridges the two declarations.
    return convertSchemaToJsonSchema(parameters as SchemaInput) as JsonSchemaObject
  } catch {
    return { type: "object" }
  }
}

/**
 * Agent-supplied input is untrusted: a Standard Schema in `parameters` validates it before the
 * host's code runs (null means rejected); plain JSON Schemas have no validator and pass through.
 */
export async function validateParameters(
  parameters: ParametersSchema | undefined,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!parameters || !("~standard" in parameters)) return input
  const result = (await (parameters as StandardSchemaV1)["~standard"].validate(input)) as {
    value?: Record<string, unknown>
    issues?: unknown
  }
  return result.issues ? null : result.value ?? {}
}

/**
 * Declares the registered widgets to the agent as one `render_widget` tool whose description
 * carries the per-widget catalog. `render` is the chat widget's DOM-side implementation; its
 * resolved value becomes the tool output the agent sees.
 */
export function buildRenderWidgetTool(
  widgets: Record<string, WidgetDefinition>,
  render: (input: RenderWidgetInput) => Promise<{ widget: string; rendered: boolean }>,
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
  }).client((input) => render(input as RenderWidgetInput))
}

/**
 * Declared without an execute function on purpose: the tool call stays pending while the chat
 * widget renders the questionnaire, and the user's submission resolves it through
 * `addToolResult`, which resumes the agent with the answers as the tool output.
 */
export function buildAskQuestionnaireTool() {
  return toolDefinition({
    name: ASK_QUESTIONNAIRE_TOOL,
    description: "Ask the user a short structured questionnaire rendered inline in the chat. " +
      "Use it when the next step genuinely depends on their choices instead of asking in prose. " +
      "The call stays pending until the user submits; their answers arrive as the tool output. " +
      "Skipped optional questions come back with an empty answers array.",
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
export function buildHostTools(tools: Record<string, HostToolDefinition>) {
  return Object.entries(tools).map(([name, tool]) =>
    toolDefinition({
      name,
      description: tool.description,
      inputSchema: toJsonSchema(tool.parameters) as SchemaInput,
    }).client(async (input) => {
      const validated = await validateParameters(
        tool.parameters,
        (input ?? {}) as Record<string, unknown>,
      )
      if (validated == null) throw new Error(`Input for tool "${name}" failed schema validation`)
      return await tool.execute(validated)
    })
  )
}
