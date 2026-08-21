import { convertSchemaToJsonSchema, type SchemaInput } from "@tanstack/ai/client"
import type { UIMessage } from "@tanstack/ai-client"
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type {
  JsonSchemaObject,
  ParametersSchema,
  StandardSchemaV1,
  WidgetDefinition,
} from "../client.ts"
import type { QuestionnaireItemSpec } from "./types.ts"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Widget names come from the agent; inherited keys like "constructor" must not resolve.
export function getWidget(
  widgets: Record<string, WidgetDefinition>,
  name: string,
): WidgetDefinition | undefined {
  return Object.hasOwn(widgets, name) ? widgets[name] : undefined
}

// Slot names are per tool call: per-widget names would project a repeated render
// into the oldest matching <slot> in the transcript instead of the newest.
export function slotNameForToolCall(toolCallId: string): string {
  return `astralbeam-widget-${toolCallId}`
}

export function getMessageText(message: UIMessage): string {
  return message.parts.map((part) => part.type === "text" ? part.content : "").join("")
}

// Standard Schemas convert when the library exposes Standard JSON Schema (Zod v4+,
// ArkType); validate-only ones fall back to an open object, still validated client-side.
export function toJsonSchema(parameters?: ParametersSchema): JsonSchemaObject {
  if (!parameters) return { type: "object" }
  if (!("~standard" in parameters)) return parameters
  try {
    return convertSchemaToJsonSchema(parameters as SchemaInput) as JsonSchemaObject
  } catch {
    return { type: "object" }
  }
}

// Agent-supplied input is untrusted: a Standard Schema validates it before host code
// runs (null means rejected); a plain JSON Schema has no validator and passes through.
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

// Questionnaire items arrive from the agent unvalidated, so malformed ones degrade to
// "not shown": an item needs a string name and title plus a choice or free-form input.
export function sanitizeQuestionnaireItems(rawInput: unknown): QuestionnaireItemSpec[] {
  const items = (rawInput as { items?: unknown } | undefined)?.items
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

// A tool may legitimately resolve with a null output, so "settled" checks the state
// too; an output-only check would read such a call as still running.
export function isSettledToolCall(part: { state: string; output?: unknown }): boolean {
  return part.state === "complete" || part.state === "error" || part.output !== undefined
}

// Transport errors read like "HTTP error! status: 500"; users need something actionable.
export function describeError(error: Error | undefined): string {
  const message = error?.message ?? ""
  const httpStatus = message.match(/status: (\d{3})/)?.[1]
  if (httpStatus) return `The assistant service returned an error (HTTP ${httpStatus}).`
  if (/fetch|network|load failed|connection/i.test(message)) {
    return "The assistant service could not be reached. Check your connection."
  }
  return "Something went wrong while talking to the assistant."
}
