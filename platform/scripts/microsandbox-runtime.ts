import { existsSync } from "node:fs"
import { chmod, lstat, mkdir, mkdtemp, readlink, rename, rm, symlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import process from "node:process"
import { Microsandbox } from "@astralbeam/sandbox"

import manifest from "./microsandbox.json" with { type: "json" }

async function installMicrosandboxPackage(
  directory: string,
  pkg: { name: string; integrity: string },
) {
  const response = await fetch(
    `https://registry.npmjs.org/${pkg.name}/-/${pkg.name.split("/").at(-1)}-${manifest.version}.tgz`,
    { signal: AbortSignal.timeout(120_000) },
  )
  if (!response.ok) throw new Error(`Microsandbox download returned HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (`sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}` !== pkg.integrity)
    throw new Error("Microsandbox download failed integrity verification")
  const destination = join(directory, "node_modules", pkg.name)
  await new Bun.Archive(bytes).extract(dirname(destination))
  await rename(join(dirname(destination), "package"), destination)
}

function microsandboxRuntimePaths(directory: string) {
  const target = `${process.platform}-${process.arch}` as keyof typeof manifest.targets
  const assets = manifest.targets[target]
  if (!assets) throw new Error(`Microsandbox local execution is unavailable on ${target}`)
  const home = join(directory, "microsandbox")
  const installation = join(home, `sdk-${manifest.version}-${target}`)
  const executable = process.platform === "win32" ? "msb.exe" : "msb"
  const platformPackage = join(installation, "node_modules", assets.name)
  return {
    target,
    assets,
    home,
    installation,
    executable,
    entry: join(installation, "node_modules", "microsandbox", "dist", "index.js"),
    msbPath: join(platformPackage, "bin", executable),
    libkrunfwPath: join(platformPackage, "lib", assets.library),
  }
}

export async function installMicrosandboxRuntime(options: { directory: string }) {
  const runtime = microsandboxRuntimePaths(options.directory)
  const { target, assets, home, installation, executable } = runtime
  await mkdir(home, { recursive: true, mode: 0o700 })
  if (!existsSync(installation)) {
    console.error(`Downloading Microsandbox ${manifest.version} SDK and runtime for ${target}`)
    const staging = await mkdtemp(join(home, "download-"))
    try {
      const downloads = await Promise.allSettled(
        [manifest.sdk, manifest.types, assets].map((pkg) =>
          installMicrosandboxPackage(staging, pkg),
        ),
      )
      for (const download of downloads) if (download.status === "rejected") throw download.reason
      await chmod(join(staging, "node_modules", assets.name, "bin", executable), 0o700)
      await rename(staging, installation).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error
      })
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
  validateMicrosandboxRuntime(runtime)
}

function validateMicrosandboxRuntime(runtime: ReturnType<typeof microsandboxRuntimePaths>) {
  if (!existsSync(runtime.installation))
    throw new Error(
      "Run `astralbeam-platform bootstrap --microsandbox` to prepare this runtime version.",
    )
  if (
    !existsSync(runtime.entry) ||
    !existsSync(runtime.msbPath) ||
    !existsSync(runtime.libkrunfwPath)
  )
    throw new Error(
      `Incomplete Microsandbox runtime. Remove ${runtime.installation} and run \`astralbeam-platform bootstrap --microsandbox\`.`,
    )
}

async function shortMicrosandboxHome(home: string): Promise<string> {
  if (process.platform === "win32") return home
  // Until the SDK supports a separate socket directory, a short alias avoids Unix socket limits.
  // https://github.com/superradcompany/microsandbox/blob/v0.7.13/sdk/rust/lib/runtime/sockets.rs
  const hash = new Bun.CryptoHasher("sha256").update(home).digest("hex").slice(0, 16)
  const alias = `/tmp/astralbeam-msb-${process.getuid!()}-${hash}`
  await symlink(home, alias).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error
  })
  const metadata = await lstat(alias)
  if (
    !metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid!() ||
    (await readlink(alias)) !== home
  )
    throw new Error(`Microsandbox runtime alias is unavailable: ${alias}`)
  return alias
}

/** Checks an installed runtime and host without installing binaries or a guest image. */
export async function checkMicrosandboxRuntime(options: { directory: string }) {
  if (!existsSync(join(options.directory, "microsandbox"))) return undefined
  const runtime = microsandboxRuntimePaths(options.directory)
  validateMicrosandboxRuntime(runtime)
  process.env.MSB_HOME = await shortMicrosandboxHome(runtime.home)
  process.env.MSB_PATH = runtime.msbPath
  process.env.MSB_LIBKRUNFW_PATH = runtime.libkrunfwPath
  const available = await Microsandbox.available()
  return available ? runtime.entry : undefined
}
