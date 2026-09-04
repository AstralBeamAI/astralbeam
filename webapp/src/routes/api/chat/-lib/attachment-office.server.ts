import { unzipSync } from "fflate"

import {
  CHAT_ATTACHMENT_MAX_OFFICE_ENTRY_BYTES,
  CHAT_ATTACHMENT_MAX_SHEET_CELLS,
  CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS,
} from "./constants.server"
import { type AttachmentTable, profileRows } from "./attachment-profile.server"

/**
 * Text and structure extraction for the OOXML office formats: `.docx`, `.pptx`, and `.xlsx`.
 *
 * All three are ZIP containers of XML parts, so one reader serves them and each format needs only
 * to know which parts hold its content. The extraction is deliberately text-level — it pulls the
 * text nodes rather than modelling the document — because the agent needs the words and the table
 * shape, and the original file is also written into the sandbox for anything richer.
 *
 * References:
 * - ECMA-376 Part 1 (OOXML): https://ecma-international.org/publications-and-standards/standards/ecma-376/
 * - SpreadsheetML cell and shared-string parts: https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-sheets
 */

export interface OfficeExtraction {
  /** The plain-text view of the file, which is what `read_attachment` serves. */
  text: string
  /** Sheets of a workbook, profiled like any other table. */
  tables?: AttachmentTable[]
  /** Countable divisions the agent can cite, such as slides. */
  sections?: { label: string; count: number }
  /** The text view stopped at a cap; the whole file is still in the sandbox. */
  truncated?: boolean
}

/** Why a file that claims to be an office document could not be read as one. */
export interface OfficeExtractionFailure {
  reason: string
}

const decoder = new TextDecoder("utf-8")

/**
 * Reads the named parts out of the container. `filter` runs before anything is inflated and
 * `originalSize` is the entry's declared uncompressed size, so a compression bomb is refused
 * without allocating it — the reason this uses fflate's filter rather than unzipping everything.
 */
function readParts(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Record<string, string> {
  const files = unzipSync(bytes, {
    filter: (file) =>
      wanted(file.name) && file.originalSize <= CHAT_ATTACHMENT_MAX_OFFICE_ENTRY_BYTES,
  })
  return Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, decoder.decode(content)]),
  )
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

/** Resolves the predefined entities and numeric character references XML text nodes may hold. */
function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#")) {
      const point = code[1] === "x" || code[1] === "X"
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10)
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match
    }
    return XML_ENTITIES[code] ?? match
  })
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
}

/** Collapses the runs of whitespace paragraph-per-line extraction leaves behind. */
function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

function clampText(text: string): { text: string; truncated: boolean } {
  return text.length > CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS
    ? { text: text.slice(0, CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS), truncated: true }
    : { text, truncated: false }
}

// Word runs: a text node, or one of the breaks that carry position rather than characters. A cell
// closing right after its only paragraph loses the paragraph break, so single-paragraph cells (the
// common case) come out tab-separated on one line instead of one line each.
const DOCX_TOKENS =
  /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*?\/?>|<w:(?:br|cr)\b[^>]*?\/?>|<\/w:tc>|<\/w:tr>|<\/w:p>/g

function docxText(xml: string): string {
  const collapsed = xml.replace(/<\/w:p>(\s*<\/w:tc>)/g, "$1")
  let text = ""
  for (const match of collapsed.matchAll(DOCX_TOKENS)) {
    const [token, content] = match
    if (content !== undefined) text += decodeXml(content)
    else if (token.startsWith("<w:tab") || token === "</w:tc>") text += "\t"
    else text += "\n"
  }
  return tidy(text)
}

const PPTX_TOKENS = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*?\/?>|<\/a:p>/g

function pptxSlideText(xml: string): string {
  let text = ""
  for (const match of xml.matchAll(PPTX_TOKENS)) {
    const [, content] = match
    text += content === undefined ? "\n" : decodeXml(content)
  }
  return tidy(text)
}

/** `ppt/slides/slide10.xml` must sort after `slide9.xml`, which a string comparison gets wrong. */
function slideNumber(name: string): number {
  return Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0)
}

function extractDocx(bytes: Uint8Array): OfficeExtraction | OfficeExtractionFailure {
  const parts = readParts(bytes, (name) => name === "word/document.xml")
  const document = parts["word/document.xml"]
  if (document === undefined) return { reason: "it holds no Word document part." }
  const { text, truncated } = clampText(docxText(document))
  return { text, ...(truncated ? { truncated } : {}) }
}

function extractPptx(bytes: Uint8Array): OfficeExtraction | OfficeExtractionFailure {
  const parts = readParts(bytes, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  const slides = Object.keys(parts).sort((first, second) =>
    slideNumber(first) - slideNumber(second)
  )
  if (slides.length === 0) return { reason: "it holds no PowerPoint slides." }
  const { text, truncated } = clampText(
    slides.map((name, index) => `## Slide ${index + 1}\n${pptxSlideText(parts[name] ?? "")}`)
      .join("\n\n"),
  )
  return {
    text,
    sections: { label: "slide", count: slides.length },
    ...(truncated ? { truncated } : {}),
  }
}

/** Shared strings are one `<si>` per string, itself possibly split across formatting runs. */
function sharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return []
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, item]) =>
    [...(item ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map(([, text]) => decodeXml(text ?? "")).join("")
  )
}

// Built-in number formats that mean "date" or "time", per ECMA-376 Part 1 §18.8.30.
const BUILTIN_DATE_FORMATS = new Set([
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  45,
  46,
  47,
])

/**
 * Which cell styles render as dates. Without this a date column reads as five-digit serial
 * numbers, which is worse than useless in a card the agent plans from.
 */
function dateStyles(xml: string | undefined): Set<number> {
  if (xml === undefined) return new Set()
  const custom = new Set<number>()
  for (const [, tag] of (xml.matchAll(/<numFmt\b([^>]*)\/>/g))) {
    const id = Number(attribute(tag ?? "", "numFmtId"))
    const code = attribute(tag ?? "", "formatCode") ?? ""
    // A date format is built from y/m/d/h tokens; strip quoted literals so a label cannot match.
    if (Number.isFinite(id) && /[ymdh]/i.test(code.replace(/"[^"]*"/g, ""))) custom.add(id)
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ""
  const styles = new Set<number>()
  let index = 0
  for (const [, tag] of cellXfs.matchAll(/<xf\b([^>]*?)\/?>/g)) {
    const id = Number(attribute(tag ?? "", "numFmtId"))
    if (BUILTIN_DATE_FORMATS.has(id) || custom.has(id)) styles.add(index)
    index += 1
  }
  return styles
}

/** Excel's day zero is 1899-12-30: the 1900 system plus its documented leap-year bug. */
const EXCEL_EPOCH_OFFSET_DAYS = 25569
const MILLISECONDS_PER_DAY = 86_400_000

function excelSerialToIso(serial: number): string {
  const milliseconds = Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * MILLISECONDS_PER_DAY)
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) return String(serial)
  const iso = date.toISOString()
  // A whole-day serial is a date; a fraction carries a time worth keeping.
  return Number.isInteger(serial) ? iso.slice(0, 10) : `${iso.slice(0, 16)}Z`
}

/** `"AB"` is the 28th column; sheets address cells by letter, grids by index. */
function columnIndex(reference: string): number {
  let index = 0
  for (const letter of reference) {
    index = index * 26 + (letter.charCodeAt(0) - 64)
  }
  return index - 1
}

// The lookahead is what keeps `<col .../>`, which a worksheet also has, from parsing as a cell and
// landing in the grid at row 0.
const XLSX_CELL = /<c(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g

function sheetRows(
  xml: string,
  strings: readonly string[],
  dates: ReadonlySet<number>,
): { rows: string[][]; total: number } {
  const rows: string[][] = []
  let cells = 0
  let highest = 0
  for (const match of xml.matchAll(XLSX_CELL)) {
    if (cells >= CHAT_ATTACHMENT_MAX_SHEET_CELLS) break
    cells += 1
    const [, attributes = "", inner = ""] = match
    const reference = attribute(attributes, "r") ?? ""
    const [, letters = "A", digits = "1"] = /^([A-Z]+)(\d+)$/.exec(reference) ?? []
    const row = Number(digits) - 1
    const column = columnIndex(letters)
    highest = Math.max(highest, row + 1)
    const type = attribute(attributes, "t")
    const raw = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "")
    let value: string
    if (type === "s") value = strings[Number(raw)] ?? ""
    else if (type === "inlineStr") {
      value = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
        .map(([, text]) => decodeXml(text ?? "")).join("")
    } else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE"
    else if (raw.length > 0 && dates.has(Number(attribute(attributes, "s") ?? -1))) {
      value = excelSerialToIso(Number(raw))
    } else value = raw
    if (value.length === 0) continue
    const target = rows[row] ??= []
    target[column] = value
  }
  // A `dimension` covers rows whose cells were all empty, so it beats the highest cell seen.
  const declared = Number(
    /<dimension\s[^>]*?ref="[A-Z]+\d+:[A-Z]+(\d+)"/.exec(xml)?.[1] ?? 0,
  )
  const filled = Array.from({ length: highest }, (_, index) => rows[index] ?? [])
  const width = filled.reduce((widest, row) => Math.max(widest, row.length), 0)
  return {
    rows: filled.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? "")),
    total: Math.max(highest, Number.isFinite(declared) ? declared : 0),
  }
}

/** Quotes a value only when it needs it, so a plain sheet renders as plain CSV. */
function csvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function extractXlsx(bytes: Uint8Array): OfficeExtraction | OfficeExtractionFailure {
  const parts = readParts(
    bytes,
    (name) =>
      name === "xl/workbook.xml" || name === "xl/sharedStrings.xml" || name === "xl/styles.xml" ||
      name === "xl/_rels/workbook.xml.rels" || /^xl\/worksheets\/[^/]+\.xml$/.test(name),
  )
  const workbook = parts["xl/workbook.xml"]
  if (workbook === undefined) return { reason: "it holds no Excel workbook part." }
  const strings = sharedStrings(parts["xl/sharedStrings.xml"])
  const dates = dateStyles(parts["xl/styles.xml"])
  // Sheet order and names live in the workbook, but the part each one points at is a relationship,
  // so a workbook whose sheets are not `sheet1..N` in order still resolves correctly.
  const targets = new Map(
    [...(parts["xl/_rels/workbook.xml.rels"] ?? "").matchAll(/<Relationship\b([^>]*)\/>/g)].map((
      [, tag],
    ) => [
      attribute(tag ?? "", "Id") ?? "",
      (attribute(tag ?? "", "Target") ?? "").replace(
        /^\/?xl\//,
        "",
      ),
    ]),
  )
  const tables: AttachmentTable[] = []
  const rendered: string[] = []
  for (const [, tag] of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = decodeXml(attribute(tag ?? "", "name") ?? `Sheet${tables.length + 1}`)
    const target = targets.get(attribute(tag ?? "", "r:id") ?? "")
    const xml = target === undefined ? undefined : parts[`xl/${target}`]
    if (xml === undefined) continue
    const { rows, total } = sheetRows(xml, strings, dates)
    tables.push(profileRows({ rows, total, name, delimiter: "," }))
    rendered.push(
      `# Sheet: ${name}\n${rows.map((row) => row.map(csvValue).join(",")).join("\n")}`,
    )
  }
  if (tables.length === 0) return { reason: "it holds no readable worksheets." }
  const { text, truncated } = clampText(rendered.join("\n\n"))
  // Sheets render as CSV so a workbook reads the same way a CSV attachment does.
  return { text, tables, ...(truncated ? { truncated } : {}) }
}

const EXTRACTORS: Record<
  string,
  (bytes: Uint8Array) => OfficeExtraction | OfficeExtractionFailure
> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": extractDocx,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": extractPptx,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": extractXlsx,
}

/**
 * Reads an office file into text the agent can work with, or explains why it could not. A
 * container that fails to open at all is reported the same way as one missing its content part:
 * both mean the bytes are not the format the file claims to be.
 */
export function extractOfficeDocument(
  bytes: Uint8Array,
  mimeType: string,
): OfficeExtraction | OfficeExtractionFailure {
  const extractor = EXTRACTORS[mimeType]
  if (!extractor) return { reason: "this assistant cannot read that office format." }
  try {
    return extractor(bytes)
  } catch {
    return { reason: "its contents could not be unpacked." }
  }
}

export function isOfficeMimeType(mimeType: string): boolean {
  return Object.hasOwn(EXTRACTORS, mimeType)
}
