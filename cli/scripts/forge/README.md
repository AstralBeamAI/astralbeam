# CLI generation

Build, check, test, and dev generate automatically. To generate directly:

```sh
bun run --cwd cli generate:api
```

Use the Bun version in `cli/package.json`. The script installs its pinned Forge, Cloudflare source, and JCO tools in a temporary directory, builds the unmodified emitter, and generates commands from `platform/public/api/openapi.json`. Temporary tools and WASM are removed afterwards. Transitive dependencies are resolved at build time, so generation is not fully reproducible.

Only operations whose security declarations allow an organization API key are generated. Edit `excludedOperations` in `generate.ts` to omit additional endpoints by OpenAPI operation ID. It excludes file upload/download and raw chat execution. Commands map to `<URL segments> <verb>`, with TenantUser commands grouped directly under `tenant-users`.

Commands and unchanged runtime helpers are written to ignored `src/generated`.

`src/forge-runtime.ts` supplies the emitter's runtime hooks and re-exports its unchanged helpers. The two `package.json` import mappings retain Forge's `#api` and `#lib/*.js` names so generated imports need no rewriting.

To upgrade, update the pins in `generate.ts`. Review regenerated commands and verify the CLI.
