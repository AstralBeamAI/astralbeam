# SDK architecture

How `@astralbeam/sdk` is put together: entry points, the embedded-React widget, the shadow-root/slot boundary, and the two-pass build behind them.

## Entry points

Each file directly under `src/` is a public entry point, listed in `tsdown.config.ts` and mapped 1:1 to a subpath in `package.json` `exports`. No root export; consumers always import a subpath.

| Entry point              | Source          | Contents                                             | Peer dependency    |
| ------------------------ | --------------- | ---------------------------------------------------- | ------------------ |
| `@astralbeam/sdk/client` | `src/client.ts` | `mountAstralBeamChat`, the framework-agnostic loader | none               |
| `@astralbeam/sdk/react`  | `src/react.tsx` | `<AstralBeamChat>` wrapper                           | `react` (optional) |
| `@astralbeam/sdk/vue`    | `src/vue.ts`    | Vue components (placeholder)                         | `vue` (optional)   |
| `@astralbeam/sdk/server` | `src/server.ts` | Server helpers (placeholder)                         | none               |

`react` and `vue` are optional peer dependencies; framework imports stay confined to their own entry point, so `/client` never pulls in a framework and `/react` never pulls in Vue.

`src/widget/` is internal: reached only via the dynamic `import()` in `src/client.ts`, never exported, no stable public API.

## The embedded React widget

The widget is a React app, but the host page may lack React or have an incompatible version. So the widget bundles its own React into a lazily loaded chunk, and every path in goes through `mountAstralBeamChat`:

- Vanilla hosts call `mountAstralBeamChat` directly. `dist/client.js` is a few hundred bytes with no React; React arrives only with the widget chunk.
- React hosts render `<AstralBeamChat>`. The wrapper runs on the _host's_ React (its hooks must resolve to the host instance — see [Invalid hook call](https://react.dev/warnings/invalid-hook-call-warning)) and calls `mountAstralBeamChat` from an effect. The mounted widget still runs on the bundled React.

Two React instances coexist by design — host's (wrapper) and widget's (everything under `src/widget/`) — sharing no hooks, context, or reconciler state.

So the React entry reaches the same chunk rather than a second copy, `src/react.tsx` imports `@astralbeam/sdk/client` — a [package self-reference](https://nodejs.org/api/packages.html#self-referencing-a-package-using-its-name), not a relative path. The import stays external in the build; at runtime it resolves through `exports` to the same `dist/client.js` a vanilla host loads, so both entries share one widget chunk.

## Widget and host boundary

`mountAstralBeamChat(target, options)` attaches a shadow root to `target` (reusing an existing one — [`attachShadow` throws if called twice](https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#exceptions)) and renders the widget inside, with widget CSS injected as a `<style>` in that root. Styles neither leak out nor inherit in.

Host UI enters via custom components, crossing the shadow boundary as [slotted light-DOM children](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_templates_and_slots), not rendered markup:

1. At mount, the host registers `customComponents`, each with a `description` for the agent.
2. To render one, the widget calls `onRenderCustomComponent` with the descriptor's `componentIndex`, agent-chosen `props`, and a `slotName`.
3. The host renders the component as a light-DOM child of `target` with `slot="<slotName>"`.
4. The widget renders a matching `<slot name="<slotName>">`; the browser projects the host element into place.

Host components thus execute in the host's own tree — state, context, and handlers keep working — while the widget controls only _where_ they appear. The React wrapper implements step 3 with render requests in `useState` rendered as slotted `<div>`s; a repeated request for a slot replaces the previous render (a slot holds one active render). Descriptors are registered once at mount; later changes to `customComponents` have no effect.

Placeholder: no agent yet, so the widget requests one test render of each registered component on startup.

## Two-pass build

`tsdown.config.ts` exports two configs, run in order by `deno task build`; the two React rules above are mutually exclusive and can't share a pass.

**Pass 1 — `client`.** `react` and `react-dom` in `deps.alwaysBundle`, so the widget becomes a self-contained chunk (`dist/widget-<hash>.js`) with React inside. Minified, since that chunk carries the vendored React. `define` replaces `process.env.NODE_ENV` with `"production"` — React branches on it and browsers lack `process`.

**Pass 2 — `react`, `vue`, `server`.** `react`, `react-dom`, and the `@astralbeam/sdk` self-reference in `deps.neverBundle`: React stays external so wrapper hooks bind to the host instance; the self-reference stays external so it resolves to pass 1's output at runtime. `clean: false`, since cleaning again would delete pass 1's output.

Both passes: `platform: "neutral"` (`client`, `react`, `vue` run in browsers — no Node-only assumptions) and `dts: true`.

Ordered, not independent: pass 2 is only correct because pass 1 already wrote the widget chunk its external self-reference points at.

## Type checking

`tsc --noEmit` (`deno task typecheck`) checks `src` and `tsdown.config.ts` from the single `tsconfig.json`, whose `paths` maps `@astralbeam/sdk/client` to `./src/client.ts`. The self-reference thus type-checks against source; resolving through `exports` would require a built `dist`, making type checking depend on build order.

## Publishing

`deno task build` produces `dist`; `npm publish` from `sdk` ships only `dist`, `README.md`, `LICENSE`, and `package.json` (`files` plus npm's always-included entries). `sideEffects: false` lets bundlers drop unused entry points.
