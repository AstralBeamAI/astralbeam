import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

export function brandAssetPath(relativePath: string) {
  return require.resolve(`@astralbeam/brand/logo/${relativePath}`)
}
