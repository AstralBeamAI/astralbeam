# CLI development

Author guide for `@astralbeam/cli`. Consumer documentation is the `README.md`, the bundled `skills/astralbeam/SKILL.md`, and the platform-hosted guides under `platform/src/routes/docs/-content/cli`.

- The CLI is a thin shell over `@astralbeam/sdk`. Call the SDK's generated `api` client, `server` token minting, and `core` chat session instead of reimplementing HTTP, JWT signing, or the chat protocol. Commands the public API cannot serve belong in the platform's `/api/v1` first.
- Keep `version` equal to `sdk/package.json`. One `v*` tag releases both, and the release workflow rejects a mismatch. Release assets carry no version, so binary download docs use version-free `releases/latest/download` URLs and need no edit on a bump.
- Write code that runs unchanged on Node 22.12+ and Bun. Use `node:` built-ins and web APIs in the published CLI.
- `tsdown` bundles every dependency into `dist/astralbeam.js`, so the npm package declares no `dependencies`. Release binaries compile that bundle with `bun build --compile --asset skills`, retaining the packaged skill beside the entry. After a Bun upgrade, smoke-test login, JWT signing, redirect refusal, streamed chat, and skill installation from an out-of-tree binary.
- Keep one module per command group in `src/`, each exporting a `register*` function that `program.ts` wires up.
- Every command honors `--json`: records and pages to stdout as the API returns them, and exactly one JSON object on stderr, `{"context"}` on success or `{"error": <problem details>, "context"}` on failure. Exit `0` on success, `1` on API or runtime failure, and `2` on usage errors. Treat these as a public contract that agents parse.
- Never accept an API key as a flag or print one unmasked. Read it from `ASTRALBEAM_API_KEY`, a hidden prompt, or stdin. Store directory bindings only in the user config file, written atomically with `0600` permissions, never in the bound directory. Send keys only to `https://` or loopback URLs, and report the resolved organization on every keyed command, as a leading stderr line in human mode and as `context` in JSON mode.
- When a command or flag changes, update `--help`, the skill, the README, and the docs pages together.
