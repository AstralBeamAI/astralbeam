# CLI development

Author guide for `@astralbeam/cli`. Consumer documentation is the `README.md`, the bundled `skills/astralbeam/SKILL.md`, and the webapp-hosted guides under `webapp/src/routes/docs/-content/cli`.

- The CLI is a thin shell over `@astralbeam/sdk`. Call the SDK's generated `api` client, `server` token minting, and `core` chat session instead of reimplementing HTTP, JWT signing, or the chat protocol. Commands the public API cannot serve belong in the webapp's `/api/v1` first.
- Keep `version` equal to `sdk/package.json`. One `v*` tag releases both, and the release workflow rejects a mismatch. Each bump also updates the version pins in `README.md` and `webapp/src/routes/docs/-content/cli/getting-started.md`.
- Write code that runs unchanged on Node 22.12+ and Deno. Use `node:` built-ins and web APIs, never `Deno.*` or Node-only globals that Deno lacks.
- `tsdown` bundles every dependency into `dist/astralbeam.js`, so the npm package declares no `dependencies`. The release compiles that bundle with `deno compile --include skills`, and the skill resolves relative to `import.meta.url` from `src/`, `dist/`, and the binary alike.
- Keep one module per command group in `src/`, each exporting a `register*` function that `program.ts` wires up.
- Every command honors `--json`: records and pages to stdout as the API returns them, and failures to stderr as `{"error": <problem details>}`. Exit `0` on success, `1` on API or runtime failure, and `2` on usage errors. Treat these as a public contract that agents parse.
- Never accept an API key as a flag or print one unmasked. Read it from `ASTRALBEAM_API_KEY`, a hidden prompt, or stdin, and store profiles with `0600` permissions.
- When a command or flag changes, update `--help`, the skill, the README, and the docs pages together.
