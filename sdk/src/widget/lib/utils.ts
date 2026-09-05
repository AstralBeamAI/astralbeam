import type { UIMessage } from "@tanstack/ai-client"
import type { WidgetDefinition } from "../../lib/types.ts"
export { hasPendingToolRun, isSettledToolCall, lastPartInProgress } from "../../core/messages.ts"
import { INHERITED_PROPERTIES, WIDGET_SLOT_PREFIX, WIDGET_SLOT_SELECTOR } from "./constants.ts"
import type { QuestionnaireItemSpec } from "./types.ts"

/** Saves a blob as a file download through a transient anchor. */
export function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  // Attached for the click to work everywhere; Safari ignores clicks on detached anchors.
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Saves agent-written text as a file download, from the content already in the transcript. */
export function downloadTextFile(filename: string, content: string): void {
  saveBlob(filename, new Blob([content], { type: "text/plain;charset=utf-8" }))
}

/** "1.2 MB" style label for an artifact row; undefined sizes read as nothing. */
export function formatByteSize(size: number | undefined): string | undefined {
  if (size === undefined) return undefined
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
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

// Tool input and output are agent- or host-supplied and land in an expandable transcript
// panel, so a value that cannot be serialized (cycles, BigInt) still has to read as text.
export function formatToolJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? ""
  } catch {
    return String(value)
  }
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
  // Restores the default relationship where `color` drives text paint: bridging the computed
  // fill color froze slotted text to the page's body ink even where a render set its own color.
  declarations.push("-webkit-text-fill-color:currentColor")
  return `${WIDGET_SLOT_SELECTOR}{${declarations.join(";")}}`
}
