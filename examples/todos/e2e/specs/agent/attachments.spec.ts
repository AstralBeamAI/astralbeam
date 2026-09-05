import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "../../fixtures.ts"

/**
 * Attachments, end to end: the composer takes a file, the message carries only its name, and the
 * endpoint gives the agent `read_attachment` to read it. The seeded `todos` agent has attachments
 * enabled, which is what makes the attach button appear at all.
 */

const sampleCsvPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "samples",
  "tasks.csv",
)

test("turns an attached spreadsheet into todos", async ({ todos, chat }) => {
  await chat.waitForReady()
  await chat.attach(sampleCsvPath)
  await expect(chat.attachmentChip("tasks.csv")).toBeVisible()

  await chat.sendAndWait("Create one todo for each task row in the attached file.")

  // The model chooses how many rows to take, so this asserts the file was actually read rather
  // than an exact count: a recognizable row from the CSV has to reach the host list.
  await expect(todos.item(/staging database/i)).toBeVisible()
  expect(await todos.items().count()).toBeGreaterThan(3)
})

test("reads an attached file's structure through the endpoint's tool", async ({ chat }) => {
  await chat.waitForReady()
  await chat.attach(sampleCsvPath)
  await chat.sendAndWait("What columns does the attached file have?")

  // A server-declared tool has no host title, so its row shows the bare registry name.
  await expect(chat.toolRow(/read_attachment/)).toBeVisible()
})
