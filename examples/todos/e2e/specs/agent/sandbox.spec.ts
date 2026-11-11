import { readFile } from "node:fs/promises"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { captureMoment } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"

test.describe("with a configured sandbox", () => {
  test.skip(
    process.env.E2E_SANDBOX !== "docker" && process.env.E2E_SANDBOX !== "microsandbox",
    "Set E2E_SANDBOX=docker or microsandbox after configuring the agent's sandbox.",
  )

  test("turns an attached spreadsheet into todos", async ({ todos, chat }) => {
    test.slow()
    await test.step("attach the sample spreadsheet", async () => {
      await chat.waitForReady()
      await chat.attach(fileURLToPath(new URL("../../../samples/tasks.csv", import.meta.url)))
      await expect(chat.attachmentChip("tasks.csv")).toBeVisible()
    })

    await chat.sendAndWait(
      "Run a command in your sandbox to read the attached CSV, then create one todo for each task row.",
    )

    await expect(chat.toolRow(/exit 0/).first()).toBeVisible()
    await expect(todos.item(/staging database/i)).toBeVisible()
    expect(await todos.items().count()).toBeGreaterThan(3)
  })

  test("pages sandbox text and downloads the saved artifact", async ({ page, chat }) => {
    test.slow()
    await chat.sendAndWait(
      "Use sandbox_write_file to create paging.txt containing exactly ALPHA, BRAVO, CHARLIE, DELTA on four separate lines, with a final newline. Then call sandbox_read_file on paging.txt with offset 2 and limit 2. Finally call sandbox_publish_artifact to share paging.txt.",
    )
    const read = chat.toolRow(/^Read .*paging\.txt/).first()
    await expect(read).toBeVisible()
    await read.click()
    await expect(chat.root.getByRole("code").filter({ hasText: "BRAVO" })).toHaveText(
      /^\s*BRAVO\s*CHARLIE\s*$/,
    )
    await captureMoment(page, "sandbox reads only the requested two lines")

    await page.reload()
    await chat.waitForReady()
    const download = page.waitForEvent("download")
    await chat.root.getByRole("button", { name: "Download paging.txt", exact: true }).click()
    const saved = await download
    expect(await readFile(await saved.path(), "utf8")).toBe("ALPHA\nBRAVO\nCHARLIE\nDELTA\n")
    await captureMoment(page, "published sandbox artifact survives reload")
  })

  test("runs a script in the sandbox and collects what it wrote", async ({ page, chat }) => {
    // Provisioning pulls an image on a cold machine, so this turn is the slowest in the suite.
    test.slow()
    await test.step("ask the agent to write and run the export script", () =>
      chat.sendAndWait(
        "Write a script that exports my todos as CSV, run it in your sandbox, and tell me the file name.",
      ))

    await test.step("check the tool rows report a real sandbox run", async () => {
      await expect(
        chat.toolRow(/Could not write/),
        "The sandbox refused a file write; check the agent's sandbox connection",
      ).toHaveCount(0)
      await expect(chat.toolRow(/^Wrote /).first()).toBeVisible()
      // A finished command only prints its exit status when it actually ran.
      await expect(chat.toolRow(/exit 0/).first()).toBeVisible()
    })

    await test.step("open the sandbox panel and check the written file is listed", async () => {
      await chat.openSandboxPanel()
      await expect(chat.sandboxTab("Files")).toBeVisible()
      // Every file the agent wrote is listed with its own download control.
      expect(await chat.sandboxFileDownloads().count()).toBeGreaterThan(0)
      await captureMoment(page, "sandbox panel with the files the agent wrote")
    })
  })
})
