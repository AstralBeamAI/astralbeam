import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs"
import { basename, dirname, join, relative } from "node:path"
import type { Plugin } from "vite"

const debugIdPlaceholder = "00000000-0000-0000-0000-000000000000"
const debugIdRegistration = `try{const stack=new Error().stack;if(stack)(globalThis._debugIds??={})[stack]="${debugIdPlaceholder}"}catch{}`

export const sourceMapDebugIds: Plugin = {
  name: "source-map-debug-ids",
  apply: "build",
  config: () => ({ build: { sourcemap: "hidden" } }),
  outputOptions(options) {
    const banner = options.postBanner
    return {
      ...options,
      sourcemap: "hidden",
      sourcemapDebugIds: true,
      postBanner: async (chunk) =>
        `${typeof banner === "function" ? await banner(chunk) : (banner ?? "")}\n${debugIdRegistration}`,
    }
  },
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk") continue
      // Register native IDs for exception SDKs. Equal-length replacement keeps map positions intact.
      const registration = chunk.map?.debugId
        ? debugIdRegistration.replace(debugIdPlaceholder, chunk.map.debugId)
        : ""
      chunk.code = chunk.code.replace(debugIdRegistration, registration)
    }
  },
}

/** Keep matching bundles and maps outside the public assets and embedded server files. */
export function collectSourceMaps(directory: string): void {
  const destination = join(dirname(directory), "sourcemaps", basename(directory))
  rmSync(destination, { recursive: true, force: true })
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const source = join(entry.parentPath, entry.name)
    if (entry.name.endsWith(".map")) {
      const target = join(destination, relative(directory, source))
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source.slice(0, -4), target.slice(0, -4))
      renameSync(source, target)
    } else if (/\.map\.(?:br|gz)$/u.test(entry.name)) rmSync(source)
  }
}
