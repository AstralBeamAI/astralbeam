# SDK architecture

How `@astralbeam/sdk` is put together: entry points, the embedded-React chat widget and its UI, the shadow-root/slot boundary, the styles pipeline, and the two-pass build behind them.

## Entry points

Each file directly under `src/` is a public entry point, listed in `tsdown.config.ts` and mapped 1:1 to a subpath in `package.json` `exports`. No root export; consumers always import a subpath.

| Entry point              | Source          | Contents                                             | Peer dependency                 |
| ------------------------ | --------------- | ---------------------------------------------------- | ------------------------------- |
| `@astralbeam/sdk/client` | `src/client.ts` | `mountAstralBeamChat`, the framework-agnostic loader | none                            |
| `@astralbeam/sdk/react`  | `src/react.tsx` | `<AstralBeamChat>` wrapper                           | `react`, `react-dom` (optional) |
| `@astralbeam/sdk/vue`    | `src/vue.ts`    | Vue components (placeholder)                         | `vue` (optional)                |
| `@astralbeam/sdk/server` | `src/server.ts` | Server helpers (placeholder)                         | none                            |

`react`, `react-dom`, and `vue` are optional peer dependencies; framework imports stay confined to their own entry point, so `/client` never pulls in a framework and `/react` never pulls in Vue.

`src/chat/` is internal: reached only via the dynamic `import()` in `src/client.ts`, never exported, no stable public API. `src/components/ui` and `src/lib` hold shadcn-generated code and are likewise internal — only files named in `tsdown.config.ts` are entry points, not everything directly under `src/` (`src/styles.css` is the Tailwind input, compiled by `deno task generate:styles`, not an entry point).

## The embedded React chat widget

The chat widget is a React app, but the host page may lack React or have an incompatible version. So it bundles its own React into a lazily loaded chunk, and every path in goes through `mountAstralBeamChat`:

- Vanilla hosts call `mountAstralBeamChat` directly. `dist/client.js` is a few hundred bytes with no React; React arrives only with the chat chunk.
- React hosts render `<AstralBeamChat>`. The wrapper runs on the _host's_ React (its hooks must resolve to the host instance — see [Invalid hook call](https://react.dev/warnings/invalid-hook-call-warning)) and calls `mountAstralBeamChat` from an effect. The mounted chat widget still runs on the bundled React.

Two React instances coexist by design — host's (wrapper) and the chat widget's (everything under `src/chat/`) — sharing no hooks, context, or reconciler state.

The chat UI is built from Tailwind v4 and shadcn/ui components generated into `src/components/ui` (add more from `sdk` with `deno task ui add <component>`; `components.json` matches webapp's style, base color, and icon library). Chat state runs on TanStack AI's `useChat`. There is no agent yet: `src/chat/conversation.ts` scripts a demo conversation with `@shadcn/helpers/tanstack-ai`, whose transport replays it through the real `useChat` lifecycle — streaming text, reasoning, and tool calls — and routes off-script input (questionnaire answers, free-form messages) to a scripted fallback. The simulated assistant drives the chat through two tool calls that `src/chat/chat-widget.tsx` interprets while rendering the transcript: `render_widget` (renders a host-defined widget into the conversation; see the boundary section) and `ask_questionnaire` (renders an inline multi-step questionnaire whose answers are sent back as a user message).

So the React entry reaches the same chunk rather than a second copy, `src/react.tsx` imports `@astralbeam/sdk/client` — a [package self-reference](https://nodejs.org/api/packages.html#self-referencing-a-package-using-its-name), not a relative path. The import stays external in the build; at runtime it resolves through `exports` to the same `dist/client.js` a vanilla host loads, so both entries share one chat chunk.

## Chat widget and host boundary

`mountAstralBeamChat(target, options)` attaches a shadow root to `target` (reusing an existing one — [`attachShadow` throws if called twice](https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#exceptions)) and renders the chat widget inside, with its CSS injected as a `<style>` in that root. Styles neither leak out nor inherit in.

Host UI enters via **widgets** — dynamic UI the agent can render with props it chooses — crossing the shadow boundary as [slotted light-DOM children](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_templates_and_slots), not rendered markup:

1. At mount, the host registers `widgets`, an object keyed by widget identifier. Each definition is shaped like a tool definition: a `description` and a `parameters` schema — a [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType, ...) or a plain JSON Schema object, forwarded to the agent verbatim — tell the agent what the widget shows and which props it may supply, and `render(props, container)` draws it. The `StandardSchemaV1` interface is vendored into `src/client.ts` (as the spec suggests) so accepting validators requires no dependency.
2. To render one, the chat widget creates a `<div slot="astralbeam-widget-<name>">` as a light-DOM child of `target` and calls the definition's `render` with the agent-chosen `props`; `render` may return a cleanup, run before the widget's next render and on unmount.
3. The chat widget renders a matching `<slot name="astralbeam-widget-<name>">` in the transcript; the browser projects the host element into place.

Widgets thus execute in the host's own environment — DOM, state, and handlers keep working — while the chat widget controls only _where_ they appear and which props the agent chose. A slot holds one active render, so a repeated request for the same widget cleans up and replaces the previous one. The React wrapper adapts `render` to JSX: it registers a DOM `render` that records the container, then [portals](https://react.dev/reference/react-dom/createPortal) the host-defined `render(props)` output into it from the host's React tree, so state, context, and event handlers keep working and live host state flows through on every host render. Widgets are registered once at mount; later changes to the `widgets` object have no effect.

Until a real agent exists, the scripted conversation stands in: when its `render_widget` tool call completes, the chat widget runs the definition's `render` once per tool call (props chosen by the script) and renders the matching `<slot>` inside the transcript.

## Chat widget styles inside the shadow root

The chat widget's stylesheet is Tailwind v4 output injected as a `<style>` in the shadow root, so it needs no `<link>` from the host and cannot collide with host CSS. `deno task generate:styles` compiles `src/styles.css` (which imports `tailwindcss`, `tw-animate-css`, and `shadcn/tailwind.css`, and scans `src/**/*.{ts,tsx}` for classes) with the Tailwind CLI, then `scripts/embed-styles.ts` wraps the result into the checked-in `src/chat/styles.generated.ts` string module. `deno task build` regenerates it before bundling; commit it alongside the source changes so type checking never depends on a build step.

Because the sheet lives in a shadow root, document-level selectors never match: theme variables and base styles sit on `:host` in `src/styles.css` instead of `:root`/`body` (Tailwind's own layers already target `:root, :host`). The theme block is a copy of the webapp light palette, kept in sync through explicit edits.

## Two-pass build

`tsdown.config.ts` exports two configs, run in order by `deno task build`; the two React rules above are mutually exclusive and can't share a pass.

**Pass 1 — `client`.** `react` and `react-dom` in `deps.alwaysBundle`, so the chat widget becomes a self-contained chunk (`dist/chat-<hash>.js`) with React inside. The chat widget's UI dependencies (Base UI, TanStack AI, `@shadcn/*`, Phosphor icons, the compiled stylesheet) are devDependencies, which tsdown inlines by default — nothing the chat widget needs may appear in `dependencies`, or hosts would have to install it. Minified, since that chunk carries the vendored React. `define` replaces `process.env.NODE_ENV` with `"production"` — React branches on it and browsers lack `process`. `alias` maps the `@/` prefix that shadcn-generated components import through, mirroring the tsconfig `paths` entry.

**Pass 2 — `react`, `vue`, `server`.** `react`, `react-dom`, and the `@astralbeam/sdk` self-reference in `deps.neverBundle`: React stays external so wrapper hooks bind to the host instance; the self-reference stays external so it resolves to pass 1's output at runtime. `clean: false`, since cleaning again would delete pass 1's output.

Both passes: `platform: "neutral"` (`client`, `react`, `vue` run in browsers — no Node-only assumptions) and `dts: true`.

Ordered, not independent: pass 2 is only correct because pass 1 already wrote the chat chunk its external self-reference points at.

## Type checking

`tsc --noEmit` (`deno task typecheck`) checks `src` and `tsdown.config.ts` from the single `tsconfig.json`, whose `paths` maps `@astralbeam/sdk/client` to `./src/client.ts`. The self-reference thus type-checks against source; resolving through `exports` would require a built `dist`, making type checking depend on build order.

## Examples

`examples/` holds standalone consumer apps, each with its own `package.json` and `deno.jsonc`, outside the SDK's module graph (knip ignores them). They depend on `@astralbeam/sdk` via `file:../..`, so imports resolve through the package `exports` to the built `dist` — run `deno task build` in `sdk` before `deno install && deno task dev` in an example. `examples/todos` deliberately uses plain CSS and no shadcn/Tailwind to demonstrate the shadow-root style boundary and an agent-rendered host widget.

## Publishing

`deno task build` produces `dist`; `npm publish` from `sdk` ships only `dist`, `README.md`, `LICENSE`, and `package.json` (`files` plus npm's always-included entries). `sideEffects: false` lets bundlers drop unused entry points.
