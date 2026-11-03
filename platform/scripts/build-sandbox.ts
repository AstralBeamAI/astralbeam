const sandboxDirectory = `${import.meta.dir}/../packages/sandbox`

await Bun.$`rm -rf ${sandboxDirectory}/dist`
await Bun.build({
  // Internal entries keep vendor SDKs separate behind the single public export.
  entrypoints: [
    ...new Bun.Glob("src/*.ts").scanSync({ cwd: sandboxDirectory, absolute: true }),
  ].sort(),
  outdir: `${sandboxDirectory}/dist`,
  // Node-compatible imports keep CommonJS/ESM chunks resolvable when Platform rebundles them.
  // https://bun.sh/docs/bundler#target
  target: "node",
  splitting: true,
  minify: true,
  // ssh2 catches missing optional native accelerators and uses its JavaScript fallback.
  // https://github.com/mscdex/ssh2/blob/master/README.md#installation
  external: ["cpu-features", "*.node"],
  plugins: [
    {
      name: "sandbox-vendor-imports",
      setup(build) {
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
