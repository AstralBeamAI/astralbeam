import type { Command } from "commander"
import { stderr } from "node:process"
import { positiveInteger } from "./options.ts"
import { printJson, printTable } from "./output.ts"

export interface ListOptions {
  search?: string
  externalId?: string
  pageSize?: number
  pageAfter?: string
  pageBefore?: string
  all?: boolean
}

interface Page<T> {
  items: T[]
  page_after: string | null
  page_before: string | null
}

interface ListParams {
  q?: string
  "filter[external_id]"?: string
  page_size?: number
  page_after?: string
  page_before?: string
}

export function addListOptions(command: Command): Command {
  return command
    .option("-q, --search <text>", "case-insensitive substring of the name or external ID")
    .option("--external-id <id>", "exact external ID, returning zero or one item")
    .option("--page-size <count>", "items per page, capped at 100 (default 20)", positiveInteger)
    .option("--page-after <cursor>", "continue after a previous page's page_after")
    .option("--page-before <cursor>", "go back from a previous page's page_before")
    .option("--all", "follow page_after to the last page and return every item")
}

export function listParams(options: ListOptions): ListParams {
  const params: ListParams = {}
  if (options.search !== undefined) params.q = options.search
  if (options.externalId !== undefined) params["filter[external_id]"] = options.externalId
  if (options.pageSize !== undefined) params.page_size = options.pageSize
  else if (options.all) params.page_size = 100
  if (options.pageAfter !== undefined) params.page_after = options.pageAfter
  if (options.pageBefore !== undefined) params.page_before = options.pageBefore
  return params
}

/** Fetches one page, or with `--all` every page after it, merged into one. */
export async function listPages<T, P extends ListParams>(
  params: P,
  all: boolean | undefined,
  fetchPage: (params: P) => Promise<Page<T>>,
): Promise<Page<T>> {
  const page = await fetchPage(params)
  if (!all) return page
  const items = [...page.items]
  let after = page.page_after
  while (after !== null) {
    const next = await fetchPage({ ...params, page_after: after })
    items.push(...next.items)
    after = next.page_after
  }
  return { items, page_after: null, page_before: page.page_before }
}

export function printPage<T extends object>(
  page: Page<T>,
  columns: readonly string[],
  json: boolean,
): void {
  if (json) return printJson(page)
  if (page.items.length === 0) stderr.write("No results.\n")
  else printTable(page.items, columns)
  if (page.page_after !== null) stderr.write(`More results: --page-after ${page.page_after}\n`)
}
