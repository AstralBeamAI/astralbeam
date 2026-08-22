import { convertSchemaToJsonSchema, type SchemaInput } from "@tanstack/ai/client"
import type { UIMessage } from "@tanstack/ai-client"
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type {
  JsonSchemaObject,
  ParametersSchema,
  StandardSchemaV1,
  WidgetDefinition,
} from "./client-types.ts"
import {
  ASK_QUESTIONNAIRE_TOOL,
  INHERITED_PROPERTIES,
  WIDGET_SLOT_PREFIX,
  WIDGET_SLOT_SELECTOR,
} from "./constants.ts"
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
  return `${WIDGET_SLOT_PREFIX}${toolCallId}`
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

// A busy stream can be silent for a while (server-side reasoning, follow-ups after tool
// results), so the transcript's "Thinking…" marker shows until the newest assistant part
// visibly makes progress.
export function lastPartInProgress(messages: UIMessage[]): boolean {
  const lastMessage = messages.at(-1)
  const lastPart = lastMessage?.role === "assistant" ? lastMessage.parts.at(-1) : undefined
  return lastPart != null && (
    ((lastPart.type === "text" || lastPart.type === "thinking") &&
      lastPart.content.length > 0) ||
    (lastPart.type === "tool-call" && !isSettledToolCall(lastPart))
  )
}

// Host tools execute between runs with status "ready". A send in that window ships their
// call unresolved: the endpoint re-offers the pending tool instead of calling the model,
// the message goes unanswered, and the redelivered call can re-execute a side-effecting
// tool — so those windows count as busy too. Questionnaires and calls to tools this mount
// never implemented stay interactive: the pre-send settle resolves them.
export function hasPendingToolRun(
  messages: UIMessage[],
  toolNames: ReadonlySet<string>,
): boolean {
  return messages.some((message) =>
    message.parts.some((part) =>
      part.type === "tool-call" && !isSettledToolCall(part) &&
      part.name !== ASK_QUESTIONNAIRE_TOOL && toolNames.has(part.name)
    )
  )
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

// Custom properties are inherited like any other, and `all` never resets them, so a host token
// such as `--card` would otherwise resolve against this sheet's palette of the same name. The
// CSSOM exposes no per-element enumeration, so names are collected from the page's stylesheets
// once and their values read per update. Cross-origin sheets throw on `cssRules`, so they are
// skipped; their tokens stay unreachable.
export function collectCustomPropertyNames(): string[] {
  const names = new Set<string>()
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        for (const property of rule.style) if (property.startsWith("--")) names.add(property)
      } else if (rule instanceof CSSImportRule) {
        try {
          if (rule.styleSheet) visit(rule.styleSheet.cssRules)
        } catch { /* cross-origin import */ }
      } else if (rule instanceof CSSGroupingRule) {
        visit(rule.cssRules)
      }
    }
  }
  for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
    try {
      visit(sheet.cssRules)
    } catch { /* cross-origin sheet */ }
  }
  return [...names]
}

/**
 * Builds the one rule that gives every widget slot the host page's inherited style. Slotted
 * content inherits through the flattened tree, whose parent is the slot in this shadow root, so
 * without it a render inherits the chat's typography and resolves `var()` against the chat's own
 * tokens. One rule covers slots that do not exist yet, so nothing has to be applied per render.
 * https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scoping
 */
export function hostStyleRule(source: Element, customProperties: readonly string[]): string {
  const computed = getComputedStyle(source)
  const declarations: string[] = []
  for (const property of [...INHERITED_PROPERTIES, ...customProperties]) {
    const value = computed.getPropertyValue(property)
    // A custom property may legitimately hold a `{}` block, which would close the rule early and
    // drop every declaration after it; skipping such a value costs one token, not the whole rule.
    if (!value || value.includes("{") || value.includes("}")) continue
    declarations.push(`${property}:${value}`)
  }
  return `${WIDGET_SLOT_SELECTOR}{${declarations.join(";")}}`
}
