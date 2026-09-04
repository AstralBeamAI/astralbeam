import {
  CHAT_ATTACHMENT_PROFILE_SAMPLE_ROWS,
  CHAT_ATTACHMENT_PROFILE_VALUE_CHARACTERS,
} from "./constants.server"

/**
 * Deterministic descriptions of an attachment's shape, for the card the model reads instead of the
 * file's bytes. Pure — no I/O, no globals — so every shape here is unit-testable.
 *
 * A profile is metadata with examples, never the content: a table reports its columns and a few
 * sample rows, and the agent reaches the rest with `read_attachment` or with code in the sandbox.
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
  /** Inferred from the sampled rows only, so it is a hint the agent should verify in code. */
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
  /** Leading data rows, for the card. */
  sample: string[][]
}

/** Candidates in preference order; the first one that splits the header wins a tie. */
const DELIMITERS = [",", "\t", ";", "|"]

/**
 * Reads delimited text in one pass, keeping only the first `keep` rows and counting the rest.
 * Quote-aware, so a value containing the delimiter or a newline neither splits a field nor
 * inflates the row count. A 10 MB CSV therefore costs one scan and a handful of retained rows.
 */
export function readDelimitedRows(
  text: string,
  delimiter: string,
  keep: number,
): { rows: string[][]; total: number } {
  const rows: string[][] = []
  let total = 0
  let row: string[] = []
  let value = ""
  let quoted = false
  let started = false

  const endValue = () => {
    row.push(value)
    value = ""
  }
  const endRow = () => {
    endValue()
    // A trailing newline at the end of the file is a terminator, not an empty final record.
    if (!(row.length === 1 && row[0] === "")) {
      total += 1
      if (rows.length < keep) rows.push(row)
    }
    row = []
    started = false
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character !== '"') {
        value += character
        continue
      }
      // A doubled quote inside a quoted field is one literal quote (RFC 4180 §2.7).
      if (text[index + 1] === '"') {
        value += '"'
        index += 1
        continue
      }
      quoted = false
      continue
    }
    if (character === '"' && !started) {
      quoted = true
      started = true
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
    value += character
    started = true
  }
  if (value.length > 0 || row.length > 0) endRow()
  return { rows, total }
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

function clampValue(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim()
  return collapsed.length > CHAT_ATTACHMENT_PROFILE_VALUE_CHARACTERS
    ? `${collapsed.slice(0, CHAT_ATTACHMENT_PROFILE_VALUE_CHARACTERS)}…`
    : collapsed
}

/**
 * Profiles rows already in memory — a parsed sheet, or the rows kept from a delimited scan.
 * `total` is the row count of the whole file, which may exceed what was kept.
 */
export function profileRows(
  input: { rows: readonly string[][]; total: number; name?: string; delimiter?: string },
): AttachmentTable {
  const [first, ...rest] = input.rows
  const header = first !== undefined && isHeaderRow(first)
  const dataRows = header ? rest : input.rows
  const width = input.rows.reduce((widest, row) => Math.max(widest, row.length), 0)
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
    sample: dataRows.slice(0, CHAT_ATTACHMENT_PROFILE_SAMPLE_ROWS).map((row) =>
      Array.from({ length: width }, (_, index) => clampValue(row[index] ?? ""))
    ),
  }
}

/** Profiles delimited text (CSV, TSV, and anything else with a consistent separator). */
export function profileDelimitedText(text: string): AttachmentTable {
  const delimiter = sniffDelimiter(text)
  // Enough rows for type inference to see past a leading block of blanks, still bounded.
  const { rows, total } = readDelimitedRows(text, delimiter, 50)
  return profileRows({ rows, total, delimiter })
}
