import { rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"

const source = fileURLToPath(new URL("../packages/sandbox/", import.meta.url))
const outdir = join(source, "dist")

await rm(outdir, { recursive: true, force: true })
await Bun.build({
  // Internal entries keep vendor SDKs separate behind the single public export.
  entrypoints: ["index", "daytona", "docker", "e2b", "sprites", "vercel"].map((name) =>
    join(source, "src", `${name}.ts`),
  ),
  outdir,
  // Node-compatible imports keep CommonJS/ESM chunks resolvable when Platform rebundles them.
  // https://bun.sh/docs/bundler#target
  target: "node",
  splitting: true,
  minify: true,
  external: ["cpu-features"],
  plugins: [
    {
      name: "sandbox-vendor-imports",
      setup(build) {
        // ssh2 catches missing optional native accelerators and uses its JavaScript fallback.
        // https://github.com/mscdex/ssh2/blob/master/README.md#installation
        build.onResolve({ filter: /\.node$/ }, ({ path }) => ({
          path: `./${basename(path)}`,
          external: true,
        }))
        // Remove when Daytona's runtime loaders use statically resolvable imports.
        // https://github.com/daytonaio/daytona/blob/main/libs/sdk-typescript/src/utils/Import.ts
        build.onLoad({ filter: /\/@daytona\/sdk\/esm\/utils\/Import\.js$/ }, async ({ path }) => ({
          contents: (await Bun.file(path).text())
            .replaceAll(
              /__esmRequire\('(busboy|form-data|tinyglobby|@iarna\/toml|tar|expand-tilde|@opentelemetry\/api)'\)/g,
              "require('$1')",
            )
            .replace("import(/* @vite-ignore */ path)", "import('../ObjectStorage.js')"),
        }))
      },
    },
  ],
})
