import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  checkMicrosandboxRuntime,
  installMicrosandboxRuntime,
  pullMicrosandboxImage,
} from "./microsandbox-runtime.ts"
import manifest from "./microsandbox.json" with { type: "json" }

const target = `${process.platform}-${process.arch}` as keyof typeof manifest.targets
let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "astralbeam-microsandbox-test-"))
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network must not be used")))
  vi.stubEnv("MSB_HOME", undefined)
  vi.stubEnv("MSB_PATH", undefined)
  vi.stubEnv("MSB_LIBKRUNFW_PATH", undefined)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(async () => {
  const home = process.env.MSB_HOME
  if (home?.startsWith("/tmp/astralbeam-msb-")) await rm(home, { force: true })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

async function cacheMicrosandboxDoctor(script: string) {
  const runtime = join(
    directory,
    "microsandbox",
    `sdk-${manifest.version}-${target}`,
    "node_modules",
  )
  const platformPackage = join(runtime, manifest.targets[target].name)
  const sdk = join(runtime, "microsandbox")
  await mkdir(join(platformPackage, "bin"), { recursive: true })
  await mkdir(join(platformPackage, "lib"), { recursive: true })
  await mkdir(join(sdk, "dist"), { recursive: true })
  const msbPath = join(platformPackage, "bin", "msb")
  const libkrunfwPath = join(platformPackage, "lib", manifest.targets[target].library)
  await writeFile(msbPath, `#!/bin/sh\n${script}\n`, { mode: 0o700 })
  await writeFile(libkrunfwPath, "fixture")
  await writeFile(join(sdk, "dist", "index.js"), "")
  return join(sdk, "dist", "index.js")
}

describe.skipIf(process.platform === "win32" || !manifest.targets[target])(
  "Microsandbox readiness",
  () => {
    it("reuses an installed runtime without reaching the network", async () => {
      const sdkPath = await cacheMicrosandboxDoctor("printf 'Host prerequisites passed' >&2")

      await installMicrosandboxRuntime({ directory })
      expect(await checkMicrosandboxRuntime({ directory })).toBe(sdkPath)
      expect(fetch).not.toHaveBeenCalled()
      const home = process.env.MSB_HOME!
      expect(await realpath(home)).toBe(await realpath(join(directory, "microsandbox")))
      await rm(home)
      await symlink(directory, home)
      await expect(checkMicrosandboxRuntime({ directory })).rejects.toThrow(
        "runtime alias is unavailable",
      )
    })

    it("does not install a missing runtime during startup", async () => {
      expect(await checkMicrosandboxRuntime({ directory })).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
      expect(await readdir(directory)).toStrictEqual([])
    })

    it("prepares the configured image without forcing a cache refresh", async () => {
      const argumentsFile = join(directory, "pull-arguments")
      await cacheMicrosandboxDoctor(
        `printf '%s\\n' "$@" >> '${argumentsFile}'\nprintf '%s' "$MSB_HOME" > '${join(directory, "pull-home")}'`,
      )

      await pullMicrosandboxImage({ directory, image: "operator/sandbox:latest" })
      await pullMicrosandboxImage({ directory, image: "operator/sandbox:latest" })
      expect(await readFile(argumentsFile, "utf8")).toBe(
        "image\npull\noperator/sandbox:latest\n".repeat(2),
      )
      const home = await readFile(join(directory, "pull-home"), "utf8")
      expect(await realpath(home)).toBe(await realpath(join(directory, "microsandbox")))
      await rm(home)
    })

    it("reports failing prerequisites", async () => {
      await cacheMicrosandboxDoctor("printf 'KVM access denied' >&2\nexit 1")

      await expect(checkMicrosandboxRuntime({ directory })).resolves.toBeUndefined()
      expect(console.error).toHaveBeenCalledWith(
        "Microsandbox host check failed: KVM access denied",
      )
    })

    it("kills a stalled diagnostic", async () => {
      const pidFile = join(directory, "doctor.pid")
      await cacheMicrosandboxDoctor(`echo $$ > '${pidFile}'\nexec sleep 30`)

      await expect(checkMicrosandboxRuntime({ directory })).resolves.toBeUndefined()
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("one-second timeout"))
      const pid = Number(await readFile(pidFile, "utf8"))

      expect(() => process.kill(pid, 0)).toThrow()
    })

    it("rejects corrupted downloads before extraction and removes staging files", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response("corrupted archive"))

      await expect(installMicrosandboxRuntime({ directory })).rejects.toThrow(
        "integrity verification",
      )

      expect(await readdir(join(directory, "microsandbox"))).toStrictEqual([])
    })
  },
)
