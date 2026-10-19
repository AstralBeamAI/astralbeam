import { type ChildProcess, execFile, spawn } from "node:child_process"
import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { env as processEnvironment, kill as killProcess } from "node:process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { brotliDecompressSync, gunzipSync, zstdDecompressSync } from "node:zlib"

import { Client } from "pg"

import packageJson from "../package.json" with { type: "json" }

const BINARY_CHECK_START_TIMEOUT_MS = 20_000
const BINARY_CHECK_FETCH_TIMEOUT_MS = 2_000
const runBinaryCheckCommand = promisify(execFile)

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
    server.close((error) => (error ? reject(error) : resolve()))
  })
  return port
}

async function fetchBinaryCheckResponse(url: URL, options?: BunFetchRequestInit) {
  const deadline = Date.now() + BINARY_CHECK_START_TIMEOUT_MS
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        ...options,
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

async function checkBinaryAssetCompression(url: URL) {
  let identity: Buffer | undefined
  for (const [acceptEncoding, encoding, decode] of [
    ["identity", null, null],
    ["gzip, deflate, br, zstd", "br", brotliDecompressSync],
    ["br;q=1, identity;q=0", "br", brotliDecompressSync],
    ["br;q=0.5, gzip;q=1", "gzip", gunzipSync],
    ["br;q=0, zstd;q=1, identity;q=0", "zstd", zstdDecompressSync],
    ["br;q=0.5, identity;q=1", null, null],
    ["*;q=0, identity;q=1", null, null],
    ["*;q=1, br;q=0, gzip;q=0, identity;q=0", "zstd", zstdDecompressSync],
  ] as const) {
    const response = await fetchBinaryCheckResponse(url, {
      headers: { "Accept-Encoding": acceptEncoding },
      decompress: false,
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (
      response.headers.get("content-encoding") !== encoding ||
      !response.headers
        .get("vary")
        ?.toLowerCase()
        .split(",")
        .some((value) => value.trim() === "accept-encoding")
    ) {
      throw new Error(
        `Binary served incorrect compression headers for ${url.pathname} (${acceptEncoding})`,
      )
    }
    if (identity === undefined) {
      identity = bytes
    } else if (
      !(decode ? decode(bytes) : bytes).equals(identity) ||
      (encoding !== null && bytes.length >= identity.length)
    ) {
      throw new Error(
        `Binary served invalid compressed bytes for ${url.pathname} (${acceptEncoding})`,
      )
    }
  }
  for (const acceptEncoding of ["br;q=0, gzip;q=0, zstd;q=0, identity;q=0", "*;q=0"]) {
    const response = await fetch(url, {
      headers: { "Accept-Encoding": acceptEncoding },
      signal: AbortSignal.timeout(BINARY_CHECK_FETCH_TIMEOUT_MS),
    })
    await response.body?.cancel()
    if (response.status !== 406) {
      throw new Error(`Binary ignored rejected encodings for ${url.pathname} (${acceptEncoding})`)
    }
  }
}

async function checkBinaryDocsDiscovery(baseUrl: URL) {
  const sitemap = await fetchBinaryCheckResponse(new URL("/docs/sitemap.xml", baseUrl))
  const titles = new Set<string>()
  for (const [, location] of (await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/gu)) {
    const url = new URL(new URL(location!).pathname, baseUrl)
    const response = await fetchBinaryCheckResponse(url)
    const html = await response.text()
    const title = /<title>([^<]+)<\/title>/u.exec(html)?.[1]
    if (!title || titles.has(title) || !/<meta name="description" content="[^"]+"/u.test(html)) {
      throw new Error(`Docs metadata is missing or duplicated at ${url.pathname}`)
    }
    titles.add(title)
    if (response.headers.get("link") !== `<${url.href}>; rel="canonical"`) {
      throw new Error(`Docs canonical does not match the running deployment at ${url.pathname}`)
    }
  }
  if (titles.size === 0) throw new Error("Docs sitemap did not contain any pages")

  const canonical = new URL("/docs/sdk/getting-started", baseUrl)
  for (const suffix of ["/", "?utm_source=check", ".md"]) {
    const response = await fetchBinaryCheckResponse(new URL(`${canonical.href}${suffix}`))
    await response.body?.cancel()
    if (response.headers.get("link") !== `<${canonical.href}>; rel="canonical"`) {
      throw new Error(`Docs variant ${suffix} did not identify its HTML canonical`)
    }
  }
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

async function stopBinaryCheckProcess(binaryProcess: ChildProcess, status: Promise<void>) {
  if (binaryProcess.exitCode !== null || binaryProcess.signalCode !== null) {
    throw new Error("Binary exited before completing its smoke check")
  }
  signalBinaryCheckProcess(binaryProcess, "SIGTERM")
  const stopped = await Promise.race([
    status.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (stopped) {
    if (binaryProcess.exitCode !== 0) {
      throw new Error("Binary did not exit cleanly after SIGTERM")
    }
    return
  }
  signalBinaryCheckProcess(binaryProcess, "SIGKILL")
  await status
  throw new Error("Binary did not exit within 5 seconds of SIGTERM")
}

async function runBinaryCheck() {
  const platformDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
  const binaryPath = join(platformDirectory, ".output", "astralbeam-platform")
  const binaryInfo = await stat(binaryPath)
  const binarySizeMiB = binaryInfo.size / 1024 / 1024
  for (const args of [["version"], ["--version"]]) {
    const { stdout } = await runBinaryCheckCommand(binaryPath, args)
    const expected = `astralbeam-platform ${packageJson.version} (`
    if (!stdout.startsWith(expected)) {
      throw new Error(
        `\`${args.join(" ")}\` printed ${stdout.trim()}, expected ${expected}<target>)`,
      )
    }
  }
  const { stdout: help } = await runBinaryCheckCommand(binaryPath, ["--help"])
  if (!/^ {2}migrate \[options\]/m.test(help)) throw new Error("--help did not list migrate")
  if (!/^ {2}upgrade \[options\] \[version\]/m.test(help)) {
    throw new Error("--help did not list upgrade")
  }

  // CI provisions an empty database here. The release job builds without one.
  const migrateDatabaseUrl = processEnvironment.BINARY_CHECK_DATABASE_URL
  if (migrateDatabaseUrl) {
    const migrationNames = (
      await readdir(join(platformDirectory, "src", "db", "migrations"))
    ).sort()
    const { stdout: dryRun } = await runBinaryCheckCommand(binaryPath, ["migrate", "--dry-run"], {
      env: { ...processEnvironment, DATABASE_URL: migrateDatabaseUrl },
    })
    const pendingNames = dryRun
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
    if (pendingNames.join() !== migrationNames.join()) {
      throw new Error(`\`migrate --dry-run\` did not list every embedded migration:\n${dryRun}`)
    }
    const client = new Client({ connectionString: migrateDatabaseUrl })
    await client.connect()
    try {
      const { rows } = await client.query<{ tables: number }>(
        "select count(*)::int as tables from pg_tables where schemaname not in ('pg_catalog', 'information_schema')",
      )
      if (rows[0]?.tables !== 0) throw new Error("`migrate --dry-run` left tables behind")
    } finally {
      await client.end()
    }
  }

  const publicAssetsDirectory = join(platformDirectory, ".output", "public", "assets")
  const assetNames = await readdir(publicAssetsDirectory)
  const stylesheetName = assetNames.find((name) => /^styles-.+\.css$/.test(name))
  const scriptName = assetNames.find((name) => name.endsWith(".js.br"))?.slice(0, -3)
  if (!stylesheetName || !scriptName)
    throw new Error("Build output did not contain CSS and JavaScript")

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "astralbeam-binary-check-"))
  const port = await reserveBinaryCheckPort()
  const baseUrl = new URL(`http://127.0.0.1:${port}`)
  const binaryProcess = spawn(binaryPath, [], {
    cwd: temporaryDirectory,
    env: {
      ...processEnvironment,
      // Exercise production shutdown. srvx skips signal handlers when CI or TEST is set.
      // https://github.com/h3js/srvx/blob/v1.0.5/src/_plugins.ts
      CI: "",
      TEST: "",
      APP_BASE_URL: baseUrl.href,
      PORT: String(port),
    },
    stdio: "inherit",
  })
  const status = waitForBinaryCheckProcess(binaryProcess)

  try {
    for (const path of [
      `/assets/${stylesheetName}`,
      `/assets/${scriptName}`,
      "/docs/sdk/getting-started",
      "/api/openapi.json",
    ]) {
      await checkBinaryAssetCompression(new URL(path, baseUrl))
    }

    const docsUrl = new URL("/docs/sdk/getting-started", baseUrl)
    const openapi = await fetchBinaryCheckResponse(new URL("/api/openapi.json", baseUrl))
    const specification = (await openapi.json()) as { paths: Record<string, unknown> }
    if (
      openapi.headers.get("access-control-allow-origin") !== "*" ||
      openapi.headers.get("cache-control") !== "public, max-age=300, must-revalidate" ||
      !openapi.headers.get("etag") ||
      !specification.paths["/api/v1/tenants"]
    ) {
      throw new Error("Binary did not serve the canonical OpenAPI asset with cache/CORS headers")
    }
    const docs = await fetchBinaryCheckResponse(docsUrl)
    const etag = docs.headers.get("etag")
    await docs.body?.cancel()
    if (
      !etag ||
      docs.headers.get("cache-control") !== "public, no-cache" ||
      docs.headers.get("x-content-type-options") !== "nosniff" ||
      docs.headers.get("content-security-policy") !== "frame-ancestors 'none'"
    ) {
      throw new Error("Binary did not serve docs with cache and security headers")
    }
    const cached = await fetch(docsUrl, { headers: { "If-None-Match": etag } })
    if (cached.status !== 304) {
      throw new Error("Binary did not revalidate unchanged docs")
    }
    await checkBinaryDocsDiscovery(baseUrl)
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
