# SDK redesign roadmap

Layered-headless redesign of `@astralbeam/sdk`: keep the drop-in widget as the default, expose progressively more ownership (slots → hook + primitives → framework-free core), harden the client/server boundary, and rework the sandbox surface.

## Motivation

- All three real integrations (`examples/todos`, nanoknow, bmd-astralbeam-demo) fight the same walls: hand-duplicated theme palettes, all-or-nothing header, no imperative reset, untyped tool/widget props, copy-pasted token endpoints, shadow-DOM style leaks.
- `systemPrompt` rides in browser-sent `forwardedProps`, so any tenant user can rewrite agent instructions from devtools; attachments are client-declared rather than agent policy.
- The sandbox tray occupies the composer footer for every conversation and only surfaces text; generated files cannot be downloaded and images cannot be shown.

## References

- TanStack Table v9 feature architecture: https://raw.githubusercontent.com/tanstack/table/main/docs/guide/features.md (philosophy adopted: headless state core; full feature-registration deliberately not adopted — chat capabilities are server-driven).
- shadcn data table (headless core + owned UI): https://ui.shadcn.com/docs/components/radix/data-table
- Provider byte access exists but is unused: `@tanstack/ai-sandbox` `SandboxFs.readBytes` (mandatory on all four providers).

## Decisions (user-approved 2026-09-01)

- Architecture: layered headless (L0 drop-in widget, L1 slots + ref, L2 `useAstralBeamChat` + React primitives, L3 framework-free core).
- Distribution: primitives ship as npm exports from `@astralbeam/sdk/react`; a shadcn-style registry is a possible follow-up, not in scope.
- Client `systemPrompt` is removed entirely; the chat endpoint rejects it. Prompts live only in the dashboard.
- Sandbox work is phased: SDK-side panel rework and transcript-content downloads first; webapp artifact route and inline images after.

## Phases

### Phase 1 — folder restructure and docs (this change)

Boundaries become structural instead of filename conventions. No behavior change.

- `src/lib/` — shared, eager-safe: public option types (ex `client-types.ts`), defaults (ex `client-constants.ts`), `createDebugLogger` (ex `client-utils.ts`). Must not import React or widget modules.
- `src/client/index.ts` — the vanilla loader entry (ex `client.ts`).
- `src/widget/` — the lazy chunk with bundled React: ex `src/chat/*` plus `src/components/*` and the lazy half of `src/lib` (`types`, `constants`, `utils`, `attachments`, `sandbox`, stream debug callbacks).
- `src/react/index.tsx`, `src/server/index.ts` (+ test), `src/vue/index.ts` — ex top-level entry files.
- Config anchors: `tsdown.config.ts` entries, `tsconfig.json` `paths`, `components.json` aliases, `knip.jsonc` ignore, `deno.jsonc` fmt/lint excludes, `.gitignore`, `package.json` `generate:styles` write allowlist, `scripts/embed-styles.ts` output path.
- Default `chatEndpoint` becomes `https://app.astralbeam.ai/api/chat` (was `/api/chat`).
- `README.md` and `AGENTS.md` rewritten to the scannable format: 1–2 intro sentences per section, ≤6–8 bullets of ≤25 words, short code examples.
- New public `/docs` section in the webapp (user decision, 2026-09-01): Markdown guides under `webapp/src/routes/docs/-content/sdk/`, a manifest in `-lib/content.ts`, rendered with `@tanstack/markdown`; the SDK README links to `https://app.astralbeam.ai/docs/sdk/<page>`. Future sections (self-hosting, ...) add a content folder plus a manifest entry.

### Phase 2 — DX quick wins

- `defineTool` / `defineWidget` helpers inferring `execute`/`render` input types from Standard Schema; document `z.coerce` for model-sent stringified scalars.
- Imperative handle on `<AstralBeamChat>` via `ref`: `reset`, `stop`, `update`.
- `header`, `empty`, and `composerActions` slots on the drop-in, projected through the existing light-DOM `<slot>` mechanism; `preload={false}` to defer the lazy chunk.
- `createAstralBeamTokenRoute()` in `@astralbeam/sdk/server`: fetch-standard handler factory replacing the copy-pasted 503/500/`no-store` endpoint.
- Fix the `-webkit-text-fill-color` inheritance leak onto widget slots (bmd's documented gotcha).

### Phase 3 — sandbox panel rework (SDK only)

- Panel hidden by default; `sandboxPanel: true` opts in. Transcript rows stay.
- Replace the footer collapsible/tabs with a slim provisioning status pill plus a slide-over panel: file list with kind icons and line counts, command timeline.
- Download buttons for agent-written text files, served from transcript content as blobs (no server change; same pattern as user attachments).

### Phase 4 — client/server boundary (webapp + SDK)

- Remove `systemPrompt` from `MountAstralBeamChatOptions` and props; `webapp/src/routes/api/chat` rejects a forwarded `systemPrompt`.
- Agent capability policy in the dashboard: attachments on/off and limits become agent config, enforced by the endpoint.
- Authenticated `GET /api/chat/config` handshake: the widget renders capabilities the agent grants; client options can only narrow, never grant. Documented as the security model.

### Phase 5 — artifacts: downloads and inline images (webapp + SDK)

- `handle.fs.readBytes` behind a new authenticated file route with short-lived signed tickets (an `<img src>` cannot carry a bearer header), magic-byte MIME verification (no inline SVG), and a download size cap distinct from `CHAT_SANDBOX_MAX_FILE_CHARACTERS`.
- Artifact announcements ride in sandbox tool outputs (`mimeType` + ticket) so they survive re-render; transcript renders images inline with a download affordance.
- CORS: allow `GET`, expose `content-disposition`.

### Phase 6 — headless core and React primitives

- `src/core/`: framework-free `createAstralBeamChat()` (auth loop, SSE connection, message store, tool/widget protocol, sandbox derivation) with `subscribe`/`getState`, new `./core` export.
- `@astralbeam/sdk/react` gains `useAstralBeamChat()` and unstyled primitives (`ChatRoot`, `ChatTranscript`, `ChatComposer`, part renderer overrides) rendered in the host tree — no shadow root, host styling.
- The drop-in widget is reimplemented on the core; Vue entry becomes a core consumer later.

## Validation

- Per phase: `deno task ready` from `sdk` before each PR; `examples/todos` exercised against the rebuilt `dist`.
- Phases 4–5 add webapp Vitest coverage for endpoint rejection, ticket auth, and MIME verification; UI phases verified in the browser with screenshot evidence.

## Boundaries

- nanoknow and bmd-astralbeam-demo are external consumers pinned to `0.0.6`; they migrate on their own schedule and are out of scope.
- No shadcn registry hosting, no Vue implementation, no durable `SandboxInstanceStore` in this effort.
- The two-pass tsdown build (bundled React in the widget chunk, external React in `./react`) and the eager/lazy boundary are preserved throughout.
