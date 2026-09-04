import { expect, test } from "vitest"

import {
  profileDelimitedText,
  profileRows,
  readDelimitedRows,
  sniffDelimiter,
} from "./attachment-profile.server"

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

test("pads a ragged row to the widest one so no column is missed", () => {
  const table = profileRows({ rows: [["a", "b", "c"], ["1"], ["2", "3", "4"]], total: 3 })
  expect(table.columns).toHaveLength(3)
  expect(table.sample[0]).toEqual(["1", "", ""])
})

test("clamps a long sample value instead of pasting it into the card", () => {
  const table = profileRows({ rows: [["note"], ["x".repeat(200)]], total: 2 })
  expect(table.sample[0]?.[0]).toHaveLength(49)
  expect(table.sample[0]?.[0]?.endsWith("…")).toBe(true)
})
