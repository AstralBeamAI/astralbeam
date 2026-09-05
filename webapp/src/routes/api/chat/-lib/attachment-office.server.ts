import { unzipSync } from "fflate"

import {
  CHAT_ATTACHMENT_DOCX_MIME_TYPE,
  CHAT_ATTACHMENT_MAX_OFFICE_ARCHIVE_BYTES,
  CHAT_ATTACHMENT_MAX_OFFICE_ENTRIES,
  CHAT_ATTACHMENT_MAX_SHEET_CELLS,
  CHAT_ATTACHMENT_MAX_TABLE_COLUMNS,
  CHAT_ATTACHMENT_MAX_TABLE_ROWS,
  CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS,
  CHAT_ATTACHMENT_PPTX_MIME_TYPE,
  CHAT_ATTACHMENT_XLSX_MIME_TYPE,
} from "./constants.server"
import { type AttachmentTable, profileRows } from "./attachment-profile.server"
import type { ChatAttachmentContent } from "./types"

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

/** An office file always has a text view, so `text` is required where the shared shape has it optional. */
type OfficeExtraction = ChatAttachmentContent & { text: string }

/** Why a file that claims to be an office document could not be read as one. */
interface OfficeExtractionFailure {
  reason: string
}

const decoder = new TextDecoder("utf-8")

/** An archive whose declared contents are too large to inflate, refused before they are. */
class OfficeArchiveTooLargeError extends Error {
  override readonly name = "OfficeArchiveTooLargeError"
}

/**
 * Reads the named parts out of the container. `filter` runs before anything is inflated and
 * `originalSize` is the entry's declared uncompressed size, so a compression bomb is refused
 * without allocating it — the reason this uses fflate's filter rather than unzipping everything.
 *
 * The budget is archive-wide rather than per entry: `unzipSync` inflates every selected entry
 * before it returns, so thousands of individually modest parts still add up to gigabytes, and a
 * per-entry cap below the archive's could only ever skip a part — which surfaced to the agent as
 * "it holds no document part" rather than the truth. Throwing stops the unpack and says why.
 */
function readParts(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Record<string, string> {
  let selected = 0
  let declared = 0
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!wanted(file.name)) return false
      selected += 1
      declared += file.originalSize
      if (
        selected > CHAT_ATTACHMENT_MAX_OFFICE_ENTRIES ||
        declared > CHAT_ATTACHMENT_MAX_OFFICE_ARCHIVE_BYTES
      ) {
        throw new OfficeArchiveTooLargeError()
      }
      return true
    },
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

/**
 * An element name with any namespace prefix, since a prefix is the producer's choice and not part
 * of the format: one writer emits `<sheetData>`, another `<x:sheetData>`, and a pattern that
 * hardcodes either one reads a valid file as empty.
 */
const NAME = "(?:[A-Za-z_][\\w.-]*:)?"

/** `<name …>text</name>`, capturing the text. */
function element(name: string): string {
  return `<${NAME}${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${NAME}${name}>`
}

/** `<name …>` or `<name …/>`, capturing the attributes. */
function tag(name: string): string {
  return `<${NAME}${name}(?=[\\s/>])([^>]*?)/?>`
}

// Compiled once per attribute name: `attribute` is called two or three times for every cell, so a
// 200,000-cell sheet was building half a million `RegExp` objects.
const ATTRIBUTE_PATTERNS = new Map<string, RegExp>()

function attribute(source: string, name: string): string | undefined {
  let pattern = ATTRIBUTE_PATTERNS.get(name)
  if (pattern === undefined) {
    pattern = new RegExp(`\\b${name}="([^"]*)"`)
    ATTRIBUTE_PATTERNS.set(name, pattern)
  }
  return pattern.exec(source)?.[1]
}

const TEXT_NODES = new RegExp(element("t"), "g")

/** Every text node under an element, joined: one string may be split across formatting runs. */
function textNodes(xml: string): string {
  let text = ""
  for (const [, content] of xml.matchAll(TEXT_NODES)) text += decodeXml(content ?? "")
  return text
}

/** One `<si>` per shared string. */
const SHARED_STRING_ITEMS = new RegExp(element("si"), "g")

/** The Word tokens that mean "next cell" rather than "next line". */
const TAB_TOKEN = new RegExp(`^<${NAME}tab|^</${NAME}tc>`)

/** Collapses the runs of whitespace paragraph-per-line extraction leaves behind. */
function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

// `truncated?: true` rather than `truncated: boolean`, so a caller can relay the result whole
// instead of translating a `false` back into an absent key.
function clampText(text: string): { text: string; truncated?: true } {
  return text.length > CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS
    ? { text: text.slice(0, CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS), truncated: true }
    : { text }
}

// Word runs: a text node, or one of the breaks that carry position rather than characters. A cell
// closing right after its only paragraph loses the paragraph break, so single-paragraph cells (the
// common case) come out tab-separated on one line instead of one line each.
const DOCX_TOKENS = new RegExp(
  [
    element("t"),
    tag("tab"),
    tag("br"),
    tag("cr"),
    `</${NAME}tc>`,
    `</${NAME}tr>`,
    `</${NAME}p>`,
  ].join("|"),
  "g",
)

function docxText(xml: string): string {
  const collapsed = xml.replace(new RegExp(`</${NAME}p>(\\s*</${NAME}tc>)`, "g"), "$1")
  let text = ""
  for (const match of collapsed.matchAll(DOCX_TOKENS)) {
    const [token, content] = match
    if (content !== undefined) text += decodeXml(content)
    else if (TAB_TOKEN.test(token)) text += "\t"
    else text += "\n"
  }
  return tidy(text)
}

const PPTX_TOKENS = new RegExp([element("t"), tag("br"), `</${NAME}p>`].join("|"), "g")

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
  return clampText(docxText(document))
}

function extractPptx(bytes: Uint8Array): OfficeExtraction | OfficeExtractionFailure {
  const parts = readParts(bytes, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  const slides = Object.keys(parts).sort((first, second) =>
    slideNumber(first) - slideNumber(second)
  )
  if (slides.length === 0) return { reason: "it holds no PowerPoint slides." }
  return {
    ...clampText(
      slides.map((name, index) => `## Slide ${index + 1}\n${pptxSlideText(parts[name] ?? "")}`)
        .join("\n\n"),
    ),
    sections: { label: "slide", count: slides.length },
  }
}

/** Shared strings are one `<si>` per string, itself possibly split across formatting runs. */
function sharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return []
  const strings: string[] = []
  for (const [, item] of xml.matchAll(SHARED_STRING_ITEMS)) strings.push(textNodes(item ?? ""))
  return strings
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
 * numbers, which is worse than useless in a profile the agent plans from.
 */
function dateStyles(xml: string | undefined): Set<number> {
  if (xml === undefined) return new Set()
  const custom = new Set<number>()
  for (const [, tag] of (xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?numFmt\b([^>]*)\/>/g))) {
    const id = Number(attribute(tag ?? "", "numFmtId"))
    const code = attribute(tag ?? "", "formatCode") ?? ""
    // A date format is built from y/m/d/h tokens; strip quoted literals so a label cannot match.
    if (Number.isFinite(id) && /[ymdh]/i.test(code.replace(/"[^"]*"/g, ""))) custom.add(id)
  }
  const cellXfs =
    /<(?:[A-Za-z_][\w.-]*:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?cellXfs>/.exec(xml)
      ?.[1] ?? ""
  const styles = new Set<number>()
  let index = 0
  for (const [, tag] of cellXfs.matchAll(/<(?:[A-Za-z_][\w.-]*:)?xf\b([^>]*?)\/?>/g)) {
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
const XLSX_CELL =
  /<(?:[A-Za-z_][\w.-]*:)?c(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>)/g

function sheetRows(
  xml: string,
  strings: readonly string[],
  dates: ReadonlySet<number>,
): { rows: string[][]; total: number; truncated: boolean } {
  const rows: string[][] = []
  let cells = 0
  let highest = 0
  let truncated = false
  for (const match of xml.matchAll(XLSX_CELL)) {
    if (cells >= CHAT_ATTACHMENT_MAX_SHEET_CELLS) break
    cells += 1
    const [, attributes = "", inner = ""] = match
    const reference = attribute(attributes, "r") ?? ""
    const [, letters = "A", digits = "1"] = /^([A-Z]+)(\d+)$/.exec(reference) ?? []
    const row = Number(digits) - 1
    const column = columnIndex(letters)
    // A cell's coordinate is whatever the file says, and `XFD1048576` is a valid one, so a lone
    // value out there must not decide how big the grid is.
    if (
      !Number.isInteger(row) || row < 0 || row >= CHAT_ATTACHMENT_MAX_TABLE_ROWS ||
      column < 0 || column >= CHAT_ATTACHMENT_MAX_TABLE_COLUMNS
    ) {
      truncated = true
      continue
    }
    highest = Math.max(highest, row + 1)
    const type = attribute(attributes, "t")
    const raw = decodeXml(
      /<(?:[A-Za-z_][\w.-]*:)?v>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/.exec(inner)?.[1] ??
        "",
    )
    let value: string
    if (type === "s") value = strings[Number(raw)] ?? ""
    else if (type === "inlineStr") {
      value = textNodes(inner)
    } else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE"
    else if (raw.length > 0 && dates.has(Number(attribute(attributes, "s") ?? -1))) {
      value = excelSerialToIso(Number(raw))
    } else value = raw
    if (value.length === 0) continue
    const target = rows[row] ??= []
    target[column] = value
  }
  // A `dimension` covers rows whose cells were all empty, so it beats the highest cell seen. It is
  // only ever reported as a count, never allocated from, but it is clamped for the same reason.
  const declared = Number(
    /<(?:[A-Za-z_][\w.-]*:)?dimension\s[^>]*?ref="[A-Z]+\d+:[A-Z]+(\d+)"/.exec(xml)
      ?.[1] ?? 0,
  )
  const total = Math.min(
    Math.max(highest, Number.isFinite(declared) ? declared : 0),
    CHAT_ATTACHMENT_MAX_TABLE_ROWS,
  )
  // Left ragged on purpose: the rows a sparse sheet never mentioned stay empty arrays rather than
  // becoming `highest × width` filled slots, and both consumers read past the end of a short row.
  return {
    rows: Array.from({ length: highest }, (_, index) => rows[index] ?? []),
    total,
    truncated,
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
    [...(parts["xl/_rels/workbook.xml.rels"] ?? "").matchAll(
      /<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/>/g,
    )].map((
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
  for (const [, tag] of workbook.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*?)\/?>/g)) {
    const name = decodeXml(attribute(tag ?? "", "name") ?? `Sheet${tables.length + 1}`)
    const target = targets.get(attribute(tag ?? "", "r:id") ?? "")
    const xml = target === undefined ? undefined : parts[`xl/${target}`]
    if (xml === undefined) continue
    const { rows, total, truncated } = sheetRows(xml, strings, dates)
    tables.push(profileRows({ rows, total, name, delimiter: ",", columnsTruncated: truncated }))
    // The rows are ragged, so each one is padded to the sheet's width only while it is rendered.
    const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
    const lines = rows.map((row) =>
      Array.from({ length: width }, (_, index) => csvValue(row[index] ?? "")).join(",")
    )
    rendered.push(`# Sheet: ${name}\n${lines.join("\n")}`)
  }
  if (tables.length === 0) return { reason: "it holds no readable worksheets." }
  // Sheets render as CSV so a workbook reads the same way a CSV attachment does.
  return { ...clampText(rendered.join("\n\n")), tables }
}

const EXTRACTORS: Record<
  string,
  (bytes: Uint8Array) => OfficeExtraction | OfficeExtractionFailure
> = {
  [CHAT_ATTACHMENT_DOCX_MIME_TYPE]: extractDocx,
  [CHAT_ATTACHMENT_PPTX_MIME_TYPE]: extractPptx,
  [CHAT_ATTACHMENT_XLSX_MIME_TYPE]: extractXlsx,
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
  } catch (error) {
    if (error instanceof OfficeArchiveTooLargeError) {
      return { reason: "it declares more content than this assistant will unpack." }
    }
    return { reason: "its contents could not be unpacked." }
  }
}

export function isOfficeMimeType(mimeType: string): boolean {
  return Object.hasOwn(EXTRACTORS, mimeType)
}
