import { spawnSync } from "node:child_process"

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

  test("runs a script in the sandbox and collects what it wrote", async ({ page, chat }) => {
    // Provisioning pulls an image on a cold machine, so this turn is the slowest in the suite.
    test.slow()
    await chat.sendAndWait(
      "Write a script that exports my todos as CSV, run it in your sandbox, and tell me the file name.",
    )

    // The server chooses the socket, so a daemon the CLI can reach is not necessarily one the
    // webapp can: on macOS with OrbStack, export DOCKER_HOST=unix:///var/run/docker.sock.
    await expect(
      chat.toolRow(/Could not write/),
      "The sandbox refused a file write, which usually means the server could not reach Docker",
    ).toHaveCount(0)
    await expect(chat.toolRow(/^Wrote /)).toBeVisible()
    // A finished command only prints its exit status when it actually ran.
    await expect(chat.toolRow(/exit 0/)).toBeVisible()

    await chat.openSandboxPanel()
    await expect(chat.sandboxTab("Files")).toBeVisible()
    // Every file the agent wrote is listed with its own download control.
    expect(await chat.sandboxFileDownloads().count()).toBeGreaterThan(0)
    await captureMoment(page, "sandbox panel with the files the agent wrote")
  })
})
