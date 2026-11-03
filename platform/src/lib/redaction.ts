import { formatJson } from "effect/Formatter"

const secretFields =
  "authorization|cookie|set-cookie|(?:(?:current|new|confirm)[_-]?)?password|passwd|secret|credentials?|api[_-]?key|(?:access|refresh|auth|id|csrf)[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|token|cf-turnstile-response"
const secretField = new RegExp(`^(?:data-)?(?:${secretFields})$`, "iu")
const secretAssignment = new RegExp(
  `(\\b(?:${secretFields})["']?\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|["']?[^"'&,\\s<>]+)`,
  "giu",
)

function redactSensitiveText(key: string, value: string): string {
  const redacted = value
    // Better Auth places reset credentials in the path rather than a token query parameter.
    .replace(/(\/api\/auth\/reset-password\/)[^/?#\s"']+/gu, "$1[REDACTED]")
    .replace(/(\b[a-z][a-z\d+.-]*:\/\/[^/\s:@]+:)[^/\s@]*@/giu, "$1[REDACTED]@")
    .replace(/\b(Bearer|Basic)\s+[\w.~+/*-]+=*/giu, "$1 [REDACTED]")
    .replace(
      /\b(?:(?:key_[\da-f-]{36}_[\da-f-]{36}_)?abo_[\w-]+|sk-[\w*-]+|(?:gh[pousr]_|github_pat_)\w+|xox[baprs]-[\w-]+|AIza[\w-]{35}|(?:AKIA|ASIA)[A-Z\d]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)/gu,
      "[REDACTED]",
    )
    .replace(
      /([?&#](?:token|(?:access|refresh|auth|id)[_-]?token|api[_-]?key|secret|password|signature|x-amz-(?:credential|signature|security-token))=)[^&#\s"')]+/giu,
      "$1[REDACTED]",
    )
    // Limit OAuth codes to authentication paths, preserving ordinary URLs such as /docs?code=example.
    .replace(/(\/(?:api\/)?auth\/[^#\s"'<>]*[?&]code=)[^&#\s"')]+/giu, "$1[REDACTED]")
  // CSS variables such as --th-token are rendering data, not credential assignments.
  return key === "style" || key === "_cssText"
    ? redacted
    : redacted.replace(secretAssignment, "$1[REDACTED]")
}

/** JSON reviver shared by browser analytics, console logs, and OTLP logs. */
export function redactSensitiveValue(key: string, value: string): string
export function redactSensitiveValue(key: string, value: unknown): unknown
export function redactSensitiveValue(key: string, value: unknown): unknown {
  if (secretField.test(key)) return "[REDACTED]"
  // OTLP represents named fields as KeyValue objects rather than JSON property names.
  if (
    value !== null &&
    typeof value === "object" &&
    "key" in value &&
    typeof value.key === "string" &&
    "value" in value &&
    secretField.test(value.key)
  )
    return { ...value, value: { stringValue: "[REDACTED]" } }
  return typeof value === "string" ? redactSensitiveText(key, value) : value
}

/** Normalize runtime values before redacting nested credentials and credential-bearing text. */
export function redactValue<A>(value: A): A {
  return JSON.parse(formatJson(value), redactSensitiveValue) as A
}
