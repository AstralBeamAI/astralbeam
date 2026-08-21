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

interface QuestionnaireInput {
  items: QuestionnaireItemSpec[]
}

/** One submitted questionnaire answer, returned to the agent as part of the tool output. */
export interface QuestionnaireAnswer {
  name: string
  question: string
  answers: string[]
}

/**
 * Slot names are per tool call, not per widget: a repeated render of the same widget would
 * otherwise project into the first matching `<slot>` in the transcript instead of the newest one.
 */
export function slotNameForToolCall(toolCallId: string): string {
  return `astralbeam-widget-${toolCallId}`
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
 * Questionnaire items arrive from the agent and providers do not enforce the nested schema, so a
 * malformed item must degrade to "not shown" instead of crashing the transcript render. Items
 * survive only with a string name and title plus at least one usable choice or a free-form input.
 */
export function sanitizeQuestionnaireItems(rawInput: unknown): QuestionnaireItemSpec[] {
  const items = (rawInput as Partial<QuestionnaireInput> | undefined)?.items
  if (!Array.isArray(items)) return []
  const sanitized: QuestionnaireItemSpec[] = []
  for (const item of items as Partial<QuestionnaireItemSpec>[]) {
    if (typeof item?.name !== "string" || typeof item.title !== "string") continue
    const choices = Array.isArray(item.choices)
      ? item.choices.filter((choice) =>
        typeof choice?.value === "string" && typeof choice.label === "string"
      )
      : []
    const freeform = typeof item.input?.label === "string" &&
        typeof item.input.placeholder === "string"
      ? item.input
      : undefined
    if (choices.length === 0 && !freeform) continue
    sanitized.push({
      name: item.name,
      title: item.title,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
      required: item.required === true,
      multiple: item.multiple === true,
      choices,
      ...(freeform ? { input: freeform } : {}),
    })
  }
  return sanitized
}

/**
 * Declares the registered widgets to the agent as one `render_widget` tool whose description
 * carries the per-widget catalog. `render` is the chat widget's DOM-side implementation; its
 * resolved value becomes the tool output the agent sees.
 */
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
