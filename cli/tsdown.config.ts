import { defineConfig } from "tsdown"

// Bundles every dependency, so `npx @astralbeam/cli` installs one package with no dependencies.
export default defineConfig({
  entry: { astralbeam: "src/main.ts" },
  platform: "node",
  target: "node22",
  // package.json declares "type": "module", so .js is ESM. https://tsdown.dev/options/output-format
  fixedExtension: false,
  deps: { alwaysBundle: [/./] },
  // Emit the skill and rewrite its source URL for the package layout.
  // https://rolldown.rs/reference/InputOptions.experimental#resolvenewurltoasset
  inputOptions: { experimental: { resolveNewUrlToAsset: true } },
  outputOptions: { assetFileNames: "skills/astralbeam/[name][extname]" },
  minify: true,
})
