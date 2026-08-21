# SDK architecture

How `@astralbeam/sdk` is put together: the entry-point layout, the embedded-React chat widget, the shadow-root and slot boundary between widget and host, and the two-pass build that makes those work.

## Entry points

Every file directly under `src/` is a public entry point, listed in `tsdown.config.ts` and mapped 1:1 to a subpath in the `exports` field of `package.json`. There is no root export; consumers always import a subpath.

| Entry point              | Source          | Contents                                             | Peer dependency    |
| ------------------------ | --------------- | ---------------------------------------------------- | ------------------ |
| `@astralbeam/sdk/client` | `src/client.ts` | `mountAstralBeamChat`, the framework-agnostic loader | none               |
| `@astralbeam/sdk/react`  | `src/react.tsx` | `<AstralBeamChat>` wrapper                           | `react` (optional) |
| `@astralbeam/sdk/vue`    | `src/vue.ts`    | Vue components (placeholder)                         | `vue` (optional)   |
| `@astralbeam/sdk/server` | `src/server.ts` | Server helpers (placeholder)                         | none               |

`react` and `vue` are optional peer dependencies, so framework imports stay confined to their own entry point: importing `@astralbeam/sdk/client` never pulls in either framework, and importing `/react` never pulls in Vue.

`src/widget/` is internal. It is reached only through the dynamic `import()` in `src/client.ts` and is never exported, so it has no `exports` entry and no stable public API.

## The embedded React widget

The chat widget is a React app, but the host page is not required to have React — or to have a compatible version of it. So the widget ships with its own React copy bundled into a lazily loaded chunk, and every path into the widget goes through `mountAstralBeamChat`:

- Vanilla hosts call `mountAstralBeamChat` directly. `dist/client.js` is a few hundred bytes and contains no React; React arrives only with the widget chunk, after the dynamic import resolves.
- React hosts render `<AstralBeamChat>`. That wrapper runs on the _host's_ React (it uses `useEffect`/`useRef`/`useState`, and hooks must resolve to the host app's React instance — see [Invalid hook call](https://react.dev/warnings/invalid-hook-call-warning)) and calls `mountAstralBeamChat` from an effect. The widget it mounts still runs on the widget chunk's bundled React.

Two React instances therefore coexist by design: the host's (running the thin wrapper) and the widget's (running everything under `src/widget/`). They never share hooks, context, or reconciler state.

To make the React entry reach the same chunk rather than a second copy of it, `src/react.tsx` imports `@astralbeam/sdk/client` — a [package self-reference](https://nodejs.org/api/packages.html#self-referencing-a-package-using-its-name) — instead of a relative path. The import stays external in the build, so at runtime the consumer's bundler or Node resolves it through the `exports` field to the very `dist/client.js` a vanilla host would load, and both entry points share one widget chunk.

## Widget and host boundary

`mountAstralBeamChat(target, options)` attaches a shadow root to `target` (reusing an existing one, since [`attachShadow` throws if called twice](https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#exceptions)) and renders the widget inside it, with the widget's CSS injected as a `<style>` element in that root. Styles therefore neither leak out of nor inherit into the widget.

Host UI enters the widget through custom components, which cross the shadow boundary as [slotted light-DOM children](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_templates_and_slots) rather than as rendered markup:

1. At mount, the host registers `customComponents`, each with a `description` that tells the agent what the component does.
2. When the widget decides to render one, it calls `onRenderCustomComponent` with the descriptor's `componentIndex`, agent-chosen `props`, and a `slotName`.
3. The host renders the component as a light-DOM child of `target` carrying `slot="<slotName>"`.
4. The widget renders a matching `<slot name="<slotName>">`, and the browser projects the host's element into that position.

The consequence is that host components execute in the host's own tree — so their state, context, and event handlers keep working — while the widget controls only _where_ they appear. The React wrapper implements step 3 by keeping render requests in `useState` and rendering the corresponding entries as slotted `<div>`s; a repeated request for a slot replaces the previous one, since a slot holds at most one active render.

Current placeholder behavior: the widget has no agent yet, so it requests one test render of each registered component on startup.

## Two-pass build

`tsdown.config.ts` exports two configurations, run in order by `deno task build`, because the two React-handling rules above are mutually exclusive and cannot be expressed in a single pass:

**Pass 1 — `client`.** React and `react-dom` are in `deps.alwaysBundle`, so the dynamically imported widget is emitted as a self-contained chunk (`dist/widget-<hash>.js`) with React inside it. This pass is minified, since that chunk carries all the vendored React code. `define` replaces `process.env.NODE_ENV` with `"production"` because React's published files branch on it and browsers do not define `process`.

**Pass 2 — `react`, `vue`, `server`.** React, `react-dom`, and the `@astralbeam/sdk` self-reference are all in `deps.neverBundle`: React stays external so the wrapper's hooks bind to the host's instance, and the self-reference stays external so it resolves to pass 1's output at runtime instead of being inlined. This pass sets `clean: false`, since pass 1 already cleaned `dist` and cleaning again would delete the client output and widget chunk.

Both passes use `platform: "neutral"` (the `client`, `react`, and `vue` entries run in browsers, so no Node-only output assumptions are safe) and `dts: true` to emit `.d.ts` files alongside each entry.

The passes are ordered, not independent: pass 2's output is only correct because pass 1 has already written the widget chunk that pass 2's external self-reference points at.

## Type checking

`tsc --noEmit` (`deno task typecheck`) checks `src` and `tsdown.config.ts` from the single `tsconfig.json`. That config maps `@astralbeam/sdk/client` to `./src/client.ts` under `paths`, so the self-reference in `src/react.tsx` type-checks against source; resolving it through `exports` would instead require a built `dist` to exist, making type checking depend on build order.

## Publishing

`deno task build` produces `dist`, and `npm publish` from `sdk` ships only `dist`, `README.md`, `LICENSE`, and `package.json` (`files` plus npm's always-included entries). `sideEffects: false` lets consumer bundlers drop unused entry points.
