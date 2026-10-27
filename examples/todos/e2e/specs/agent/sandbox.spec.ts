import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"

import { captureMoment } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"

/**
 * The sandbox surface. The seed attaches a Docker sandbox provider to the `todos` agent, which is
 * what makes the endpoint hand that agent its file and command tools; the widget then shows each
 * step inline and collects them in the opt-in Sandbox panel.
 *
 * Docker itself is the one dependency the seed cannot provide, so these skip when no daemon
 * answers rather than failing.
 *
 * Assertions here deliberately read the outcome of each step, not just its presence. The widget
 * renders a file write from the tool call, so a row and even a download appear for a sandbox that
 * never started; only "Wrote" versus "Could not write", and a command's "exit 0", separate a real
 * run from a broken daemon connection.
 */

function dockerDaemonIsReachable(): boolean {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0
}

test.describe("with a Docker daemon", () => {
  test.skip(
    () => !dockerDaemonIsReachable(),
    "No Docker daemon answered `docker info`; start Docker to run the sandbox specs.",
  )

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
      // The server chooses the socket, so a daemon the CLI can reach is not necessarily one the
      // platform can: on macOS with OrbStack, export DOCKER_HOST=unix:///var/run/docker.sock.
      await expect(
        chat.toolRow(/Could not write/),
        "The sandbox refused a file write, which usually means the server could not reach Docker",
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
