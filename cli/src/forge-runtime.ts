import { astralBeamApiFetch, resolveApiUrl } from "../../sdk/src/api/api.ts"
import { stderr } from "node:process"
import { resolveCredentials, runState } from "./config.ts"
import { printJson, printResult, printTable, terminalSafe } from "./output.ts"
export type { CommonYargsOptions, InferArgs } from "./options.ts"
export * from "./generated/_runtime/body-parser.ts"
export * from "./generated/_runtime/input-validation.ts"

interface Operation {
  method: string
  path: (request: Record<string, unknown>) => string
  query?: readonly string[]
  body?: string
}

function apiQueryName(name: string): string {
  return name.replace(/^filter_(.+)$/, "filter[$1]")
}

export async function createCommandClient(_argv: unknown) {
  const { apiKey, apiUrl } = await resolveCredentials()
  return {
    send(operation: Operation, request: Record<string, unknown> = {}): Promise<unknown> {
      const query = new URLSearchParams()
      for (const name of operation.query ?? []) {
        const value = request[name]
        if (value !== undefined)
          query.set(apiQueryName(name), typeof value === "string" ? value : JSON.stringify(value))
      }
      const path = operation.path(request) + (query.size ? `?${query.toString()}` : "")
      return astralBeamApiFetch(path, {
        apiKey,
        apiUrl,
        method: operation.method,
        ...(operation.body
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(request.body) }
          : {}),
      })
    },
  }
}

export function formatOutput(value: unknown, _options: unknown): void {
  if (value === undefined) return
  if (runState.json || value === null || typeof value !== "object") return printJson(value)
  if ("items" in value && Array.isArray(value.items)) {
    const rows = value.items as object[]
    if (rows.length) printTable(rows, Object.keys(rows[0]!))
    else stderr.write("No results.\n")
    if ("page_after" in value && typeof value.page_after === "string")
      stderr.write(`More results: --page-after ${terminalSafe(value.page_after)}\n`)
  } else printResult(value, false)
}
export type ArgClassification<T> = { safeFlags: (keyof T)[] }

export function withProgress<T>(_label: string, run: () => Promise<T>): Promise<T> {
  return run()
}

let previewBaseUrl = ""
export async function runWithTelemetry<T>(
  _metadata: unknown,
  argv: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  if (argv["dryRun"]) previewBaseUrl = (await resolveCredentials()).apiUrl
  return run()
}

export function formatDryRun(value: {
  command: string
  url: string
  query?: Record<string, unknown>
  [key: string]: unknown
}): void {
  if (value.query)
    value.query = Object.fromEntries(
      Object.entries(value.query).map(([name, entry]) => [apiQueryName(name), entry]),
    )
  printJson({
    ...value,
    note: "Local request preview only. No HTTP request or server-side validation is performed.",
    command: value.command.replace(/^cf /, "astralbeam "),
    url: resolveApiUrl(new URL(value.url).pathname.replace(/^\/client\/v4/, ""), previewBaseUrl),
  })
}

export function promptForRequiredField(name: string, _description: string): Promise<string> {
  throw new Error(`Missing required option --${name} (or pass --body).`)
}
