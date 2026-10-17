import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "../../fixtures.ts"

/**
 * Attachments, end to end: the composer takes a file, the message carries only its name, and the
 * endpoint gives the agent `read_attachment` to read it. The seeded `todos` agent has attachments
 * enabled, which is what makes the attach button appear at all.
 */

const attachmentSamplesPath = fileURLToPath(new URL("../../../samples", import.meta.url))

test("turns an attached spreadsheet into todos", async ({ todos, chat }) => {
  await chat.waitForReady()
  await chat.attach(join(attachmentSamplesPath, "tasks.csv"))
  await chat.sendAndWait("Create one todo for each task row in the attached file.")

  // The model chooses how many rows to take, so this asserts the file was actually read rather
  // than an exact count: a recognizable row from the CSV has to reach the host list.
  await expect(todos.item(/staging database/i)).toBeVisible()
  expect(await todos.items().count()).toBeGreaterThan(3)
})

test("analyzes Office originals in the sandbox", async ({ todos, chat }) => {
  test.skip(
    spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0,
    "Office analysis requires the seeded Docker sandbox provider to be reachable.",
  )
  test.slow()
  await chat.waitForReady()
  await chat.attach(
    ["launch.docx", "launch.pptx", "launch.xlsx"].map((name) => join(attachmentSamplesPath, name)),
  )
  await chat.sendAndWait(
    "Analyze all three attached files using the sandbox. Read the document paragraphs and table, slide contents in order, and worksheet headers and data. Summarize their contents.",
  )
  await chat.sendAndWait(
    "Now save seven summary facts as new todos, using these exact text formats: 'DOCX code <launch code>', 'DOCX owner <Pilot owner in the table>', 'PPTX slides <slide count>', 'PPTX decision <text on slide 2 under Decision>', one 'XLSX <sheet name> rows <data rows excluding header> total <sum of Amount>' for each worksheet, and 'XLSX columns <column names separated by spaces>'. Fill the placeholders from the actual files you read. These todos record facts, not actionable tasks listed in the documents.",
  )
  for (const result of [
    "DOCX code ORBIT-47",
    "DOCX owner Mira",
    "PPTX slides 3",
    "PPTX decision Approve lunar pilot",
    "XLSX Orders rows 3 total 60",
    "XLSX Forecast rows 2 total 13",
    "XLSX columns Item Amount",
  ]) {
    await expect(todos.item(result)).toBeVisible()
  }
  await expect(chat.toolRow(/exit 0/).first()).toBeVisible()
})

test("analyzes the complete CSV beyond its bounded text view", async ({ todos, chat }) => {
  test.skip(
    spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0,
    "Full-file analysis requires the seeded Docker sandbox provider to be reachable.",
  )
  test.slow()
  await chat.waitForReady()
  await chat.attach({
    name: "full.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "task,amount,note\n" + "Task,1,abcdefghij\n".repeat(150_000) + "Final,97,LASTROW\n",
    ),
  })
  await chat.sendAndWait(
    "Use the original complete CSV in your sandbox and calculate its row count and sum of amount. The file is large, do not create one todo per row.",
  )
  await chat.sendAndWait(
    "Save one summary todo with the text 'FULL CSV rows <data rows excluding header> total <sum of amount>'. Use the complete original file, not the bounded text view.",
  )
  await expect(todos.item("FULL CSV rows 150001 total 150097")).toBeVisible()
  await expect(chat.toolRow(/exit 0/).first()).toBeVisible()
})
