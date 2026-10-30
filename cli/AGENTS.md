# CLI development

- Keep the CLI a thin shell over the SDK's generated `api` client, `server` token minting, and `core` chat session. Add missing public operations to Platform `/api/v1` first. Keep one `src` module per command group, exporting a `register*` function wired through `program.ts`.
- Published code must run unchanged on Node 22.12+ and Bun, using `node:` built-ins and web APIs.
- Preserve `--json`: API records/pages go unchanged to stdout. Stderr contains exactly one object, `{"context"}` on success or `{"error": <problem details>, "context"}` on failure. Exit `0` for success, `1` for API/runtime failures, and `2` for usage errors.
- Never accept API keys as flags or print them unmasked. Read from `ASTRALBEAM_API_KEY`, a hidden prompt, or stdin. Send keys only to HTTPS or loopback URLs. Report the resolved organization on every keyed command, in leading stderr text or JSON `context`.
- Store directory bindings only in the user config, never the bound directory. Write it atomically with `0600` permissions.
- Bundle npm dependencies, declare no runtime dependencies, and embed the skill in release binaries. After Bun upgrades, smoke-test login, JWT signing, redirect refusal, streamed chat, and skill installation from an out-of-tree binary.
- Update `--help`, [the canonical skill](../skills/astralbeam/SKILL.md), README, and `platform/src/routes/docs/-content/cli` together when commands or flags change. Binary download docs use version-free `releases/latest/download` URLs.
