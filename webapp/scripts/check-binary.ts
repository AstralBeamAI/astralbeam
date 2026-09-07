import { type ChildProcess, spawn } from "node:child_process"
import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { env as processEnvironment, kill as killProcess } from "node:process"
import { fileURLToPath } from "node:url"

const BINARY_CHECK_MAX_BYTES = 200 * 1024 * 1024
const BINARY_CHECK_START_TIMEOUT_MS = 20_000
const BINARY_CHECK_FETCH_TIMEOUT_MS = 2_000

async function reserveBinaryCheckPort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Could not reserve a TCP port for the binary")
  }
  const port = address.port
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  return port
}

async function fetchBinaryCheckResponse(url: URL) {
  const deadline = Date.now() + BINARY_CHECK_START_TIMEOUT_MS
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(BINARY_CHECK_FETCH_TIMEOUT_MS),
      })
      if (response.ok) return response
      await response.body?.cancel()
      lastError = new Error(`${url.pathname} returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Binary did not serve ${url.pathname} within 20 seconds`, {
    cause: lastError,
  })
}

function waitForBinaryCheckProcess(binaryProcess: ChildProcess) {
  if (binaryProcess.exitCode !== null || binaryProcess.signalCode !== null) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    binaryProcess.once("error", reject)
    binaryProcess.once("exit", () => resolve())
  })
}

function signalBinaryCheckProcess(binaryProcess: ChildProcess, signal: NodeJS.Signals) {
  const processId = binaryProcess.pid
  if (processId === undefined) throw new Error("Binary process did not start")
  killProcess(processId, signal)
}

async function stopBinaryCheckProcess(
  binaryProcess: ChildProcess,
  status: Promise<void>,
) {
  signalBinaryCheckProcess(binaryProcess, "SIGTERM")
  const stopped = await Promise.race([
    status.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (stopped) return
  signalBinaryCheckProcess(binaryProcess, "SIGKILL")
  await status
  throw new Error("Binary did not exit within 5 seconds of SIGTERM")
}

async function runBinaryCheck() {
  const webappDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
  const binaryPath = join(webappDirectory, ".output", "astralbeam")
  const binaryInfo = await stat(binaryPath)
  const binarySizeMiB = binaryInfo.size / 1024 / 1024
  if (binaryInfo.size > BINARY_CHECK_MAX_BYTES) {
    throw new Error(
      `Binary is ${binarySizeMiB.toFixed(1)} MiB; expected at most 200 MiB`,
    )
  }

  const publicAssetsDirectory = join(webappDirectory, ".output", "public", "assets")
  let stylesheetName: string | undefined
  for (const entry of await readdir(publicAssetsDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /^styles-.+\.css$/.test(entry.name)) {
      stylesheetName = entry.name
      break
    }
  }
  if (!stylesheetName) throw new Error("Build output did not contain a stylesheet")

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "astralbeam-binary-check-"))
  const port = await reserveBinaryCheckPort()
  const baseUrl = new URL(`http://127.0.0.1:${port}`)
  const binaryProcess = spawn(binaryPath, [], {
    cwd: temporaryDirectory,
    env: {
      ...processEnvironment,
      APP_BASE_URL: baseUrl.href,
      PORT: String(port),
    },
    stdio: "inherit",
  })
  const status = waitForBinaryCheckProcess(binaryProcess)

  try {
    const statusResponse = await fetchBinaryCheckResponse(new URL("/api/status", baseUrl))
    const status = await statusResponse.json() as { status?: unknown }
    if (status.status !== "ok") {
      throw new Error("Binary status endpoint did not report ok")
    }

    const stylesheetResponse = await fetchBinaryCheckResponse(
      new URL(`/assets/${stylesheetName}`, baseUrl),
    )
    if (!(await stylesheetResponse.text())) {
      throw new Error("Binary served an empty stylesheet")
    }
  } finally {
    try {
      await stopBinaryCheckProcess(binaryProcess, status)
    } finally {
      await rm(temporaryDirectory, { recursive: true })
    }
  }

  console.log(`Binary smoke check passed (${binarySizeMiB.toFixed(1)} MiB)`)
}

await runBinaryCheck()
