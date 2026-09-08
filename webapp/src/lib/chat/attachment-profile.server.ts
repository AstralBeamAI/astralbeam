import {
  CHAT_ATTACHMENT_MAX_TABLE_COLUMNS,
  CHAT_ATTACHMENT_PROFILE_TYPED_ROWS,
} from "./constants.server"

/**
 * Deterministic descriptions of an attachment's shape, for the agent to plan against before it
 * reads a file. Pure — no I/O, no globals — so every shape here is unit-testable.
 *
 * A profile is metadata, never content: it reports how many rows a table has and what its columns
 * look like, and the agent gets the rows themselves from `read_attachment` or from code in the
 * sandbox. Every dimension is bounded before it is allocated from, because both a worksheet's
 * coordinates and a delimited file's separators are chosen by whoever made the file.
 */

type AttachmentColumnType =
  | "integer"
  | "number"
  | "boolean"
  | "date"
  | "string"
  | "empty"

interface AttachmentColumn {
  name: string
  /** Inferred from the leading rows only, so it is a hint the agent should verify in code. */
  type: AttachmentColumnType
}

export interface AttachmentTable {
  /** Sheet name in a workbook; absent for a single-table file such as a CSV. */
  name?: string
  /** The character the file separates fields with, when it is delimited text. */
  delimiter?: string
  columns: AttachmentColumn[]
  /** Data rows excluding the header, counted across the whole file. */
  rows: number
  /** The table is wider than {@link CHAT_ATTACHMENT_MAX_TABLE_COLUMNS}, so columns stop short. */
  columnsTruncated?: boolean
}

/** Candidates in preference order; the first one that splits the header wins a tie. */
const DELIMITERS = [",", "\t", ";", "|"] as const

/**
 * Reads delimited text in one pass, keeping only the first `keep` rows and counting the rest.
 * Quote-aware, so a value containing the delimiter or a newline neither splits a field nor
 * inflates the row count.
 *
 * Past `keep` rows nothing is retained, so the scan stops assembling field strings and only
 * tracks records. That is what keeps the cost proportional to the answer rather than to the file:
 * building a string per field for all of a 10 MB CSV took 100 ms, and 438 ms when the file was one
 * enormous unbroken field, against ~24 ms and ~10 ms for counting the tail.
 *
 * Fields past the column bound are counted but not retained either: a file that is one long run of
 * separators would otherwise turn every one of them into a retained string.
 */
export function readDelimitedRows(
  text: string,
  delimiter: string,
  keep: number,
): { rows: string[][]; total: number; columnsTruncated: boolean } {
  const rows: string[][] = []
  let total = 0
  let row: string[] = []
  let fields = 0
  let value = ""
  let quoted = false
  let started = false
  let columnsTruncated = false
  /** Any character in the current record, so a bare newline is a terminator and not a record. */
  let filled = false
  /** Once the kept rows are in hand, only the record count still matters. */
  let counting = false

  const endValue = () => {
    fields += 1
    if (!counting) {
      if (row.length < CHAT_ATTACHMENT_MAX_TABLE_COLUMNS) row.push(value)
      else columnsTruncated = true
    }
    value = ""
  }
  const endRow = () => {
    endValue()
    if (filled || fields > 1) {
      total += 1
      if (rows.length < keep) rows.push(row)
    }
    row = []
    fields = 0
    started = false
    filled = false
    counting = rows.length >= keep
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character !== '"') {
        if (!counting) value += character
        filled = true
        continue
      }
      // A doubled quote inside a quoted field is one literal quote (RFC 4180 §2.7).
      if (text[index + 1] === '"') {
        if (!counting) value += '"'
        filled = true
        index += 1
        continue
      }
      quoted = false
      continue
    }
    if (character === '"' && !started) {
      quoted = true
      started = true
      filled = true
      continue
    }
    if (character === delimiter) {
      endValue()
      started = false
      continue
    }
    if (character === "\n") {
      endRow()
      continue
    }
    // A lone CR before the LF is line ending, not content; a CR anywhere else is.
    if (character === "\r" && text[index + 1] === "\n") continue
    if (!counting) value += character
    started = true
    filled = true
  }
  if (filled || fields > 0) endRow()
  return { rows, total, columnsTruncated }
}

/**
 * Picks the delimiter that splits the first lines into the most columns, consistently. Consistency
 * is what separates a real delimiter from a character that merely occurs: prose full of commas
 * splits unevenly, a CSV splits every row the same way.
 */
export function sniffDelimiter(text: string): string {
  const head = text.slice(0, 64 * 1024)
  let best = DELIMITERS[0] as string
  let bestColumns = 0
  for (const delimiter of DELIMITERS) {
    const { rows } = readDelimitedRows(head, delimiter, 10)
    if (rows.length === 0) continue
    const columns = rows[0]?.length ?? 0
    // Ignore the last kept row: a truncated head can cut it mid-record.
    const compared = rows.length > 1 ? rows.slice(0, -1) : rows
    if (columns > bestColumns && compared.every((row) => row.length === columns)) {
      best = delimiter
      bestColumns = columns
    }
  }
  return best
}

const INTEGER = /^[+-]?\d+$/
// The fractional part is optional but never optional-and-empty-and-adjacent, which is what would
// let two `\d` quantifiers trade characters and backtrack super-linearly on a long numeric cell.
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const BOOLEAN = /^(?:true|false|yes|no)$/i
// ISO 8601 dates and the two common slash orders; anything else profiles as a string.
const DATE = /^(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?|\d{1,2}\/\d{1,2}\/\d{2,4})$/

function valueType(value: string): AttachmentColumnType {
  const trimmed = value.trim()
  if (trimmed.length === 0) return "empty"
  if (INTEGER.test(trimmed)) return "integer"
  if (NUMBER.test(trimmed)) return "number"
  if (BOOLEAN.test(trimmed)) return "boolean"
  if (DATE.test(trimmed)) return "date"
  return "string"
}

/** One type for a whole column: the type its non-empty values agree on, widening int to number. */
function columnType(values: readonly string[]): AttachmentColumnType {
  let resolved: AttachmentColumnType = "empty"
  for (const value of values) {
    const type = valueType(value)
    if (type === "empty") continue
    if (resolved === "empty") resolved = type
    else if (resolved === type) continue
    else if (
      (resolved === "integer" && type === "number") || (resolved === "number" && type === "integer")
    ) resolved = "number"
    else return "string"
  }
  return resolved
}

/**
 * Treats the first row as a header when it reads like one: every cell filled, distinct, and not a
 * number or date. A file without one profiles as `column_1…` so the agent still learns the shape.
 */
function isHeaderRow(row: readonly string[]): boolean {
  if (row.length === 0) return false
  const named = row.map((value) => value.trim())
  if (named.some((value) => value.length === 0)) return false
  if (named.some((value) => valueType(value) !== "string")) return false
  return new Set(named).size === named.length
}

/**
 * Profiles rows already in memory — a parsed sheet, or the rows kept from a delimited scan. Rows
 * may be ragged; `total` is the row count of the whole file, which may exceed what was kept.
 */
export function profileRows(
  input: {
    rows: readonly string[][]
    total: number
    name?: string
    delimiter?: string
    columnsTruncated?: boolean
  },
): AttachmentTable {
  const [first, ...rest] = input.rows
  const header = first !== undefined && isHeaderRow(first)
  const dataRows = (header ? rest : input.rows).slice(0, CHAT_ATTACHMENT_PROFILE_TYPED_ROWS)
  const widest = input.rows.reduce((widest, row) => Math.max(widest, row.length), 0)
  const width = Math.min(widest, CHAT_ATTACHMENT_MAX_TABLE_COLUMNS)
  const truncated = input.columnsTruncated === true || widest > width
  const names = Array.from(
    { length: width },
    (_, index) => (header ? first?.[index]?.trim() : "") || `column_${index + 1}`,
  )
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.delimiter === undefined ? {} : { delimiter: input.delimiter }),
    columns: names.map((name, index) => ({
      name,
      type: columnType(dataRows.map((row) => row[index] ?? "")),
    })),
    rows: Math.max(0, header ? input.total - 1 : input.total),
    ...(truncated ? { columnsTruncated: true } : {}),
  }
}

/** Profiles delimited text (CSV, TSV, and anything else with a consistent separator). */
export function profileDelimitedText(text: string): AttachmentTable {
  const delimiter = sniffDelimiter(text)
  // Enough rows for type inference to see past a leading block of blanks, still bounded.
  const { rows, total, columnsTruncated } = readDelimitedRows(
    text,
    delimiter,
    CHAT_ATTACHMENT_PROFILE_TYPED_ROWS,
  )
  return profileRows({ rows, total, delimiter, columnsTruncated })
}
