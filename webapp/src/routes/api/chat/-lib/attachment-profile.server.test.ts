import { expect, test } from "vitest"

import {
  profileDelimitedText,
  profileRows,
  readDelimitedRows,
  sniffDelimiter,
} from "./attachment-profile.server"
import { CHAT_ATTACHMENT_MAX_TABLE_COLUMNS } from "./constants.server"

// A quoted field is the difference between a correct row count and a wrong one, and the agent
// plans its code against these numbers.
test("reads quoted fields that contain the delimiter, quotes, and newlines", () => {
  const csv = 'name,note\n"Doe, Jane","said ""hi""\nthen left"\nBob,plain\n'
  const { rows, total } = readDelimitedRows(csv, ",", 10)
  expect(total).toBe(3)
  expect(rows).toEqual([
    ["name", "note"],
    ["Doe, Jane", 'said "hi"\nthen left'],
    ["Bob", "plain"],
  ])
})

test("counts every row while keeping only the ones asked for", () => {
  const csv = `a,b\n${Array.from({ length: 500 }, (_, index) => `${index},x`).join("\n")}\n`
  const { rows, total } = readDelimitedRows(csv, ",", 3)
  expect(total).toBe(501)
  expect(rows).toHaveLength(3)
})

// Past the rows it keeps, the scan stops assembling fields and only counts records — but it still
// has to track quoting, or a newline inside a late quoted field would invent rows.
test("counts the tail of a file correctly without retaining it", () => {
  const head = "name,note\n"
  const quoted = '"Doe, Jane","line one\nline two"\n'
  const plain = "Bob,plain\n"
  const { rows, total } = readDelimitedRows(`${head}${quoted.repeat(20)}${plain}`, ",", 2)
  expect(rows).toHaveLength(2)
  expect(total).toBe(22)
  // The second kept row is still whole, which is what type inference reads.
  expect(rows[1]).toEqual(["Doe, Jane", "line one\nline two"])
})

test("counts a final row that has no trailing newline", () => {
  expect(readDelimitedRows("a,b\n1,2\n3,4", ",", 1).total).toBe(3)
})

test("reads a blank line as a terminator rather than a record", () => {
  expect(readDelimitedRows("a,b\n\n1,2\n\n", ",", 10).total).toBe(2)
  // Also past the point where rows stop being retained.
  expect(readDelimitedRows("a,b\n\n1,2\n\n3,4\n", ",", 1).total).toBe(3)
})

test("handles CRLF endings and a byte-order mark's leading row", () => {
  const { rows, total } = readDelimitedRows("a,b\r\n1,2\r\n", ",", 10)
  expect(total).toBe(2)
  expect(rows[1]).toEqual(["1", "2"])
})

test("picks the delimiter that splits every row the same way", () => {
  expect(sniffDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t")
  expect(sniffDelimiter("a;b;c\n1;2;3\n")).toBe(";")
  expect(sniffDelimiter("a|b\n1|2\n")).toBe("|")
  // Prose full of commas splits unevenly, so nothing wins and the default stands.
  expect(sniffDelimiter("Hello, world\nThis is, in fact, prose\n")).toBe(",")
})

test("infers a column type from its values and widens integers to numbers", () => {
  const table = profileDelimitedText(
    "id,price,flag,when,label,blank\n1,1.5,true,2024-01-02,alpha,\n2,3,false,2024-02-03,beta,\n",
  )
  expect(table.rows).toBe(2)
  expect(table.columns).toEqual([
    { name: "id", type: "integer" },
    { name: "price", type: "number" },
    { name: "flag", type: "boolean" },
    { name: "when", type: "date" },
    { name: "label", type: "string" },
    { name: "blank", type: "empty" },
  ])
})

// Without a header the agent still needs to know the shape, and a numeric first row is data.
test("synthesizes column names for a file with no header row", () => {
  const table = profileDelimitedText("1,2\n3,4\n")
  expect(table.columns.map((column) => column.name)).toEqual(["column_1", "column_2"])
  expect(table.rows).toBe(2)
})

test("treats a repeated or empty first cell as data rather than a header", () => {
  expect(profileDelimitedText("a,a\n1,2\n").columns.map((column) => column.name)).toEqual([
    "column_1",
    "column_2",
  ])
  expect(profileDelimitedText("a,\n1,2\n").rows).toBe(2)
})

test("profiles every column of a ragged table, reading a short row as empty", () => {
  const table = profileRows({ rows: [["a", "b", "c"], ["1"], ["2", "3", "4"]], total: 3 })
  expect(table.columns).toEqual([
    { name: "a", type: "integer" },
    { name: "b", type: "integer" },
    { name: "c", type: "integer" },
  ])
})

// One 10 MB row of separators would otherwise become millions of retained strings, column names,
// and column objects — the parse has to stop widening, not just the profile.
test("bounds the columns of an absurdly wide row", () => {
  const wide = `${",".repeat(CHAT_ATTACHMENT_MAX_TABLE_COLUMNS * 20)}\n`
  const { rows, columnsTruncated } = readDelimitedRows(wide, ",", 5)
  expect(rows[0]).toHaveLength(CHAT_ATTACHMENT_MAX_TABLE_COLUMNS)
  expect(columnsTruncated).toBe(true)

  const table = profileDelimitedText(wide)
  expect(table.columns).toHaveLength(CHAT_ATTACHMENT_MAX_TABLE_COLUMNS)
  expect(table.columnsTruncated).toBe(true)
  // The row itself is still counted, so the reported shape stays honest.
  expect(table.rows).toBe(1)
})

test("counts rows past the column bound without retaining their fields", () => {
  const rows = `a,b\n${",".repeat(CHAT_ATTACHMENT_MAX_TABLE_COLUMNS * 4)}\n1,2\n`
  expect(readDelimitedRows(rows, ",", 10).total).toBe(3)
})
