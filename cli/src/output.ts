import { isAstralBeamApiError } from "@astralbeam/sdk/api"
import { stderr, stdout } from "node:process"

export function printJson(value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return ""
  return typeof value === "string" ? value : JSON.stringify(value)
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

/** Writes a failure to stderr, as the API's problem body in JSON mode. */
export function printError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error)
  if (json) {
    const body = isAstralBeamApiError(error)
      ? (error.body ?? { status: error.status, detail: message })
      : { detail: message }
    stderr.write(`${JSON.stringify({ error: body })}\n`)
    return
  }
  const status = isAstralBeamApiError(error) ? ` (HTTP ${error.status})` : ""
  stderr.write(`Error: ${message}${status}\n`)
  if (isAstralBeamApiError(error)) {
    for (const issue of error.body?.issues ?? []) {
      stderr.write(`  ${issue.path}: ${issue.message}\n`)
    }
  }
}
