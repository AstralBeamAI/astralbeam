import { type AstralBeamApiError, isAstralBeamApiError } from "@astralbeam/sdk/api"
import { stderr, stdout } from "node:process"
import packageJson from "../package.json" with { type: "json" }

export function printJson(value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Escapes C0 and C1 control characters, other than those in `keep`, so API or agent text cannot
 * drive the terminal with escape sequences. JSON output needs no escaping.
 */
export function terminalSafe(text: string, keep = ""): string {
  let safe = ""
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const control = code < 0x20 || (code >= 0x7f && code < 0xa0)
    safe += control && !keep.includes(char) ? `\\u${code.toString(16).padStart(4, "0")}` : char
  }
  return safe
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return ""
  return terminalSafe(typeof value === "string" ? value : JSON.stringify(value))
}

/** One `key  value` line per field, for a single record in human-readable mode. */
function printRecord(record: object): void {
  const entries = Object.entries(record)
  const width = Math.max(...entries.map(([key]) => key.length))
  for (const [key, value] of entries) stdout.write(`${key.padEnd(width)}  ${cell(value)}\n`)
}

export function printResult(record: object, json: boolean): void {
  if (json) printJson(record)
  else printRecord(record)
}

export function printTable(rows: readonly object[], columns: readonly string[]): void {
  const cells = rows.map((row) =>
    columns.map((column) => cell((row as Record<string, unknown>)[column])),
  )
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...cells.map((row) => row[index]?.length ?? 0)),
  )
  const line = (values: readonly string[]) =>
    `${values.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  ")}`.trimEnd()
  stdout.write(`${line(columns.map((column) => column.toUpperCase()))}\n`)
  for (const row of cells) stdout.write(`${line(row)}\n`)
}

/** A next step for API failures whose detail alone does not explain the fix. */
function errorHint(error: AstralBeamApiError): string | undefined {
  if (error.status === 401) {
    return "The API key was rejected. It may be revoked or deleted, so create a new one and run `astralbeam auth login` again."
  }
  // The webapp answers unrouted paths with this generic detail, unlike missing records.
  // See webapp/src/routes/api/v1/-lib/transport.server.ts.
  if (error.status === 404 && error.body?.detail === "Resource not found.") {
    return `This server does not serve that endpoint. Check the API URL, or the server may run an older AstralBeam release than this CLI (${packageJson.version}).`
  }
  if (error.status === 429) return "The API rate limit was reached. Wait a few minutes and retry."
  return undefined
}

/**
 * Writes a failure to stderr. In JSON mode that is one object holding the API's problem body and
 * the organization `context`, null until credentials resolve.
 */
export function printError(
  error: unknown,
  json: boolean,
  context?: object,
  failedRequest?: string,
): void {
  const message = error instanceof Error ? error.message : String(error)
  if (json) {
    const body = isAstralBeamApiError(error)
      ? (error.body ?? { status: error.status, detail: message })
      : { detail: message }
    stderr.write(`${JSON.stringify({ error: body, context: context ?? null })}\n`)
    return
  }
  if (!isAstralBeamApiError(error)) return void stderr.write(`Error: ${terminalSafe(message)}\n`)
  const request = failedRequest ? ` from ${failedRequest}` : ""
  stderr.write(`Error: ${terminalSafe(message)} (HTTP ${error.status}${request})\n`)
  for (const issue of error.body?.issues ?? []) {
    stderr.write(`  ${terminalSafe(issue.path)}: ${terminalSafe(issue.message)}\n`)
  }
  const hint = errorHint(error)
  if (hint) stderr.write(`${hint}\n`)
}
