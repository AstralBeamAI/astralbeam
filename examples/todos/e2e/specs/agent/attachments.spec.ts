import { Buffer } from "node:buffer"

import { expect, test } from "../../fixtures.ts"

/**
 * Attachments, end to end: the composer takes a file, the message carries only its name, and the
 * endpoint gives the agent `read_attachment` to read it. The seeded `todos` agent has attachments
 * enabled, which is what makes the attach button appear at all.
 */

const sampleText = {
  name: "tasks.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(
    "High priority: Draft the Q3 launch brief.\n" +
      "Medium priority: Review analytics dashboard copy.\n" +
      "High priority: Migrate the staging database.\n",
  ),
}

test("turns an attached text file into todos", async ({ todos, chat }) => {
  await test.step("attach the sample text file", async () => {
    await chat.waitForReady()
    await chat.attach(sampleText)
    await expect(chat.attachmentChip("tasks.txt")).toBeVisible()
  })

  await chat.sendAndWait("Read the attached text file and create one todo for each task.")

  // The model chooses how many tasks to take, so this asserts the file was actually read rather
  // than an exact count: a recognizable task from the file has to reach the host list.
  await expect(todos.item(/staging database/i)).toBeVisible()
  expect(await todos.items().count()).toBeGreaterThan(3)
})

test("reads an attached file's structure through the endpoint's tool", async ({ chat }) => {
  await test.step("attach the sample text file", async () => {
    await chat.waitForReady()
    await chat.attach(sampleText)
  })

  await chat.sendAndWait(
    "Use read_attachment to read the attached text file and tell me its task priorities.",
  )

  // A server-declared tool has no host title, so its row shows the bare registry name.
  await expect(chat.toolRow(/read_attachment/)).toBeVisible()
})
