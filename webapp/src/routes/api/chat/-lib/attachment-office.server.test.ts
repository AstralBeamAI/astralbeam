import { strToU8, zipSync } from "fflate"
import { expect, test } from "vitest"

import { extractOfficeDocument, isOfficeMimeType } from "./attachment-office.server"
import {
  CHAT_ATTACHMENT_MAX_OFFICE_ARCHIVE_BYTES,
  CHAT_ATTACHMENT_MAX_TABLE_COLUMNS,
} from "./constants.server"

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function container(parts: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])),
  )
}

function extract(bytes: Uint8Array, mimeType: string) {
  const result = extractOfficeDocument(bytes, mimeType)
  if ("reason" in result) throw new Error(`extraction failed: ${result.reason}`)
  return result
}

test("reads a Word document's paragraphs, tabs, entities, and table cells", () => {
  const bytes = container({
    "word/document.xml": `<w:document><w:body>
      <w:p><w:r><w:t>Hello</w:t></w:r><w:tab/><w:r><w:t>world</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Second &amp; last</w:t></w:r></w:p>
      <w:tbl><w:tr>
        <w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>
      </w:tr></w:tbl>
    </w:body></w:document>`,
  })
  expect(extract(bytes, DOCX).text).toBe("Hello\tworld\nSecond & last\nA1\tB1")
})

// Field codes and tracked deletions are their own elements, so pulling only `w:t` leaves them out.
test("leaves Word field codes and deleted text out of the text", () => {
  const bytes = container({
    "word/document.xml":
      `<w:document><w:body><w:p><w:r><w:instrText>HYPERLINK "http://x"</w:instrText>` +
      `<w:delText>removed</w:delText><w:t>kept</w:t></w:r></w:p></w:body></w:document>`,
  })
  expect(extract(bytes, DOCX).text).toBe("kept")
})

test("reads slides in numeric order and counts them", () => {
  const slide = (text: string) =>
    `<p:sld><p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>${text}</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  // `slide10` sorts before `slide9` as a string, which would silently reorder a deck.
  const bytes = container({
    "ppt/slides/slide1.xml": slide("First"),
    "ppt/slides/slide10.xml": slide("Tenth"),
    "ppt/slides/slide9.xml": slide("Ninth"),
  })
  const extracted = extract(bytes, PPTX)
  expect(extracted.sections).toEqual({ label: "slide", count: 3 })
  expect(extracted.text).toBe("## Slide 1\nFirst\n\n## Slide 2\nNinth\n\n## Slide 3\nTenth")
})

const WORKBOOK_PARTS = {
  "xl/workbook.xml": `<workbook><sheets>
    <sheet name="Revenue" sheetId="1" r:id="rId1"/>
    <sheet name="Notes &amp; more" sheetId="2" r:id="rId2"/>
  </sheets></workbook>`,
  // The sheet a relationship points at is not always `sheet1.xml`, and reading them positionally
  // would hand back the wrong grid under the right name.
  "xl/_rels/workbook.xml.rels": `<Relationships>
    <Relationship Id="rId1" Target="worksheets/sheet7.xml"/>
    <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
  </Relationships>`,
  "xl/sharedStrings.xml":
    `<sst><si><t>month</t></si><si><t>sales</t></si><si><r><t>Ja</t></r><r><t>n</t></r></si></sst>`,
  "xl/styles.xml": `<styleSheet>
    <numFmts><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
    <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs>
  </styleSheet>`,
  "xl/worksheets/sheet7.xml": `<worksheet><dimension ref="A1:D3"/><sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="inlineStr"><is><t>when</t></is></c>
      <c r="D1" t="inlineStr"><is><t>ok</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c><c r="B2"><v>343</v></c>
      <c r="C2" s="1"><v>45321</v></c><c r="D2" t="b"><v>1</v></c>
    </row>
    <row r="3">
      <c r="A3" t="s"><v>2</v></c><c r="B3"><v>382</v></c>
      <c r="C3" s="1"><v>45322</v></c><c r="D3" t="b"><v>0</v></c>
    </row>
  </sheetData></worksheet>`,
  "xl/worksheets/sheet2.xml": `<worksheet><sheetData/></worksheet>`,
}

test("profiles a workbook's sheets by name, resolving each through its relationship", () => {
  const { tables, text } = extract(container(WORKBOOK_PARTS), XLSX)
  expect(tables?.map((table) => table.name)).toEqual(["Revenue", "Notes & more"])
  const revenue = tables?.[0]
  expect(revenue?.rows).toBe(2)
  expect(revenue?.columns).toEqual([
    { name: "month", type: "string" },
    { name: "sales", type: "integer" },
    { name: "when", type: "date" },
    { name: "ok", type: "boolean" },
  ])
  // Shared strings split across formatting runs are one value, not two.
  expect(text).toContain("Jan,343")
})

// A date is stored as a serial number, so without reading the cell's format the card would show
// the agent five-digit integers where the user sees dates.
test("renders date-formatted cells as dates and booleans as words", () => {
  const { text } = extract(container(WORKBOOK_PARTS), XLSX)
  expect(text).toContain("# Sheet: Revenue")
  expect(text).toContain("month,sales,when,ok")
  expect(text).toMatch(/Jan,343,\d{4}-\d{2}-\d{2},TRUE/)
})

// A namespace prefix is the producer's choice, and the xlsx path already had to learn that. Word
// and PowerPoint read the same arbitrary prefixes, so they are covered by the same rule.
test("reads Word and PowerPoint parts whose elements use unexpected namespace prefixes", () => {
  const docx = container({
    "word/document.xml": `<document><body>
      <p><r><t>Bare</t></r><tab/><r><t>prefixless</t></r></p>
      <ns0:p><ns0:r><ns0:t>Odd prefix</ns0:t></ns0:r></ns0:p>
    </body></document>`,
  })
  expect(extract(docx, DOCX).text).toBe("Bare\tprefixless\nOdd prefix")

  const pptx = container({
    "ppt/slides/slide1.xml": `<ns0:sld><ns0:txBody>
      <ns0:p><ns0:r><ns0:t>Prefixed slide</ns0:t></ns0:r></ns0:p>
    </ns0:txBody></ns0:sld>`,
  })
  expect(extract(pptx, PPTX).text).toBe("## Slide 1\nPrefixed slide")
})

// Some standards-compliant writers prefix every SpreadsheetML element instead of using a default
// namespace. The prefix must not make an otherwise valid workbook look empty.
test("reads a workbook whose SpreadsheetML elements use namespace prefixes", () => {
  const bytes = container({
    "xl/workbook.xml": `<x:workbook><x:sheets>
      <x:sheet name="Budget" sheetId="1" r:id="rId1"/>
    </x:sheets></x:workbook>`,
    "xl/_rels/workbook.xml.rels": `<r:Relationships>
      <r:Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
    </r:Relationships>`,
    "xl/sharedStrings.xml": `<x:sst>
      <x:si><x:t>item</x:t></x:si><x:si><x:t>amount_usd</x:t></x:si>
      <x:si><x:t>Launch campaign</x:t></x:si>
    </x:sst>`,
    "xl/styles.xml": `<x:styleSheet>
      <x:cellXfs count="1"><x:xf numFmtId="0"/></x:cellXfs>
    </x:styleSheet>`,
    "xl/worksheets/sheet1.xml": `<x:worksheet><x:dimension ref="A1:B2"/><x:sheetData>
      <x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c></x:row>
      <x:row r="2"><x:c r="A2" t="s"><x:v>2</x:v></x:c><x:c r="B2"><x:v>12500</x:v></x:c></x:row>
    </x:sheetData></x:worksheet>`,
  })

  const { text, tables } = extract(bytes, XLSX)
  expect(text).toBe("# Sheet: Budget\nitem,amount_usd\nLaunch campaign,12500")
  expect(tables?.[0]).toMatchObject({
    name: "Budget",
    rows: 1,
    columns: [{ name: "item", type: "string" }, { name: "amount_usd", type: "integer" }],
  })
})

/** A workbook of one sheet, so a test only has to supply the cells it cares about. */
function workbook(cells: string, dimension = "A1:B2"): Uint8Array {
  return container({
    "xl/workbook.xml":
      `<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml":
      `<worksheet><dimension ref="${dimension}"/><sheetData>${cells}</sheetData></worksheet>`,
  })
}

// `XFD1048576` is a valid Excel coordinate, so one value out there describes a 17-billion-cell
// grid. Densifying to the sheet's logical corner would allocate it despite the parsed-cell cap.
test("does not size a grid from a lone cell at the far corner of a sheet", () => {
  const { text, tables } = extract(
    workbook(
      `<row r="1"><c r="A1" t="inlineStr"><is><t>near</t></is></c></row>` +
        `<row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>far</t></is></c></row>`,
      "A1:XFD1048576",
    ),
    XLSX,
  )
  // The reachable cell survives, the unreachable one is dropped, and the shape says so.
  expect(text).toBe("# Sheet: S\nnear")
  expect(tables?.[0]?.columns).toHaveLength(1)
  expect(tables?.[0]?.columnsTruncated).toBe(true)
})

test("keeps a sheet's column count inside the bound", () => {
  const cells = Array.from(
    { length: 40 },
    (_, index) => `<c r="A${index + 1}" t="inlineStr"><is><t>v</t></is></c>`,
  ).join("")
  const { tables } = extract(workbook(`<row r="1">${cells}</row>`), XLSX)
  expect((tables?.[0]?.columns.length ?? 0) <= CHAT_ATTACHMENT_MAX_TABLE_COLUMNS).toBe(true)
})

// Per-entry size is not enough: `unzipSync` inflates every selected entry before it returns, so
// many individually modest parts still add up to gigabytes of allocation.
test("refuses an archive whose declared parts exceed the whole-archive budget", () => {
  // Highly compressible parts, each far below the per-entry cap, together past the archive cap.
  const part = "<p:sld><a:p><a:t>x</a:t></a:p></p:sld>".padEnd(4 * 1024 * 1024, " ")
  const slides = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`ppt/slides/slide${index + 1}.xml`, part]),
  )
  const bytes = container(slides)
  // The archive itself is small; only its declared contents are not.
  expect(bytes.byteLength).toBeLessThan(CHAT_ATTACHMENT_MAX_OFFICE_ARCHIVE_BYTES)
  expect(extractOfficeDocument(bytes, PPTX)).toEqual({
    reason: "it declares more content than this assistant will unpack.",
  })
})

test("explains a container that is not the office file it claims to be", () => {
  const notADocx = extractOfficeDocument(container({ "hello.txt": "hi" }), DOCX)
  expect(notADocx).toEqual({ reason: "it holds no Word document part." })
  const garbage = extractOfficeDocument(strToU8("not a zip at all"), XLSX)
  expect(garbage).toEqual({ reason: "its contents could not be unpacked." })
  expect(extractOfficeDocument(container({}), "application/zip")).toEqual({
    reason: "this assistant cannot read that office format.",
  })
})

test("knows which MIME types it can read", () => {
  expect([DOCX, PPTX, XLSX].every(isOfficeMimeType)).toBe(true)
  expect(isOfficeMimeType("application/zip")).toBe(false)
})
