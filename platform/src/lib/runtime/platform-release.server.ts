import { createHash } from "node:crypto"
import { chmodSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"

import { version as PLATFORM_VERSION } from "@/../package.json" with { type: "json" }
import { APP_HANDLE, APP_RELEASES_REPOSITORY } from "../constants.ts"

// Release asset suffixes keyed by `${process.platform}-${process.arch}`.
const RELEASE_TARGETS: Record<string, string> = {
  "linux-x64": "linux-x86_64",
  "linux-arm64": "linux-arm64",
  "darwin-x64": "macos-x86_64",
  "darwin-arm64": "macos-arm64",
  "win32-x64": "windows-x86_64.exe",
}

export const BINARY_HOST = `${process.platform}-${process.arch}`
export const RELEASE_TARGET = RELEASE_TARGETS[BINARY_HOST]

/** Orders release versions such as 0.13.4 numerically. */
export function comparePlatformVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true })
}

export function parsePlatformReleaseTag(tag: string): string {
  const version = tag.replace(/^v/, "")
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${tag} is not a release tag such as v0.13.4`)
  }
  return version
}

/** Returns the latest published GitHub release version, without its `v` prefix. */
export async function fetchLatestPlatformVersion(): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${APP_RELEASES_REPOSITORY}/releases/latest`,
  )
  if (!response.ok) throw new Error(`latest release lookup returned HTTP ${response.status}`)
  return parsePlatformReleaseTag(((await response.json()) as { tag_name: string }).tag_name)
}

/** Returns the running compiled binary, refusing to replace the runtime of a checkout. */
export function replaceablePlatformBinary(): string {
  // https://bun.sh/docs/bundler/executables
  if (!Bun.isStandaloneExecutable) {
    throw new Error("upgrade replaces a compiled binary, so pull and rebuild a checkout instead")
  }
  if (!RELEASE_TARGET) throw new Error(`no release binary for ${BINARY_HOST}`)
  return process.execPath
}

/** Replaces the running binary with a newer release after checking its SHA256SUMS entry. */
export async function installPlatformRelease(version: string): Promise<void> {
  const binaryPath = replaceablePlatformBinary()
  if (comparePlatformVersions(version, PLATFORM_VERSION) < 0) {
    throw new Error(`downgrading to ${version} is not supported, because migrations stay applied`)
  }
  // Earlier releases publish no SHA256SUMS to check the download against.
  if (comparePlatformVersions(version, "0.13.4") < 0) {
    throw new Error("upgrade supports v0.13.4 and later releases, which publish SHA256SUMS")
  }
  const asset = `${APP_HANDLE}-platform-${RELEASE_TARGET}`
  const releaseUrl = `https://github.com/${APP_RELEASES_REPOSITORY}/releases/download/v${version}`
  const sums = await fetch(`${releaseUrl}/SHA256SUMS`)
  if (!sums.ok) {
    throw new Error(`downloading v${version} SHA256SUMS returned HTTP ${sums.status}`)
  }
  // `sha256sum` writes `<hash>  <name>`, or `<hash> *<name>` in binary mode.
  const expected = (await sums.text())
    .split("\n")
    .map((line) => line.split(/ [ *]/))
    .find(([, name]) => name === asset)?.[0]
  if (!expected) throw new Error(`v${version} SHA256SUMS lists no ${asset}`)
  const response = await fetch(`${releaseUrl}/${asset}`)
  if (!response.ok) {
    throw new Error(`downloading v${version} ${asset} returned HTTP ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new Error(`v${version} ${asset} does not match its SHA256SUMS entry`)
  }
  const downloadDirectory = mkdtempSync(`${binaryPath}.upgrade-`)
  const downloadPath = join(downloadDirectory, "binary")
  try {
    writeFileSync(downloadPath, bytes, { flag: "wx" })
    chmodSync(downloadPath, 0o755)
    // Windows cannot overwrite a running executable, but it can rename one.
    if (process.platform === "win32") renameSync(binaryPath, `${binaryPath}.old`)
    try {
      renameSync(downloadPath, binaryPath)
    } catch (error) {
      if (process.platform === "win32") renameSync(`${binaryPath}.old`, binaryPath)
      throw error
    }
  } finally {
    rmSync(downloadDirectory, { recursive: true, force: true })
  }
}
