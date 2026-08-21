# SDK architecture

High-level map of `@astralbeam/sdk`: entry points, the embedded chat widget, the shadow-root/slot host boundary, the styles pipeline, and the two-pass build. Details live in the referenced files.

## Entry points

Each file directly under `src/` named in `tsdown.config.ts` is a public entry point, mapped 1:1 to a subpath in `package.json` `exports`; there is no root export.

| Entry point              | Source          | Contents                                             | Peer dependency                 |
| ------------------------ | --------------- | ---------------------------------------------------- | ------------------------------- |
| `@astralbeam/sdk/client` | `src/client.ts` | `mountAstralBeamChat`, the framework-agnostic loader | none                            |
| `@astralbeam/sdk/react`  | `src/react.tsx` | `<AstralBeamChat>` wrapper                           | `react`, `react-dom` (optional) |
| `@astralbeam/sdk/vue`    | `src/vue.ts`    | Vue components (placeholder)                         | `vue` (optional)                |
| `@astralbeam/sdk/server` | `src/server.ts` | Server helpers (placeholder)                         | none                            |

Framework peers are optional and confined to their own entry point. Everything else is internal: `src/chat/` is reached only via the dynamic `import()` in `src/client.ts`, `src/components/ui` and `src/lib` hold shadcn-generated code, and `src/styles.css` is the Tailwind input, not an entry point.

## The embedded React chat widget

The host page may lack React or run an incompatible version, so the chat widget bundles its own React into a lazily loaded chunk and every path goes through `mountAstralBeamChat`: vanilla hosts call it directly (`dist/client.js` carries no React), while React hosts render `<AstralBeamChat>`, whose hooks run on the _host's_ React ([invalid hook call](https://react.dev/warnings/invalid-hook-call-warning)) and which mounts the widget from an effect. Two React instances coexist by design, sharing no hooks, context, or reconciler state.

The UI is Tailwind v4 plus shadcn/ui components in `src/components/ui` (`deno task ui add <component>`; `components.json` matches webapp's style, base color, and icons). Chat state runs on TanStack AI's `useChat`. There is no agent yet: `src/chat/conversation.ts` scripts a demo conversation replayed through the real `useChat` lifecycle via `@shadcn/helpers/tanstack-ai`, driving two tool calls that `src/chat/chat-widget.tsx` interprets — `render_widget` (host-defined widget) and `ask_questionnaire` (inline multi-step questionnaire answered as a user message).

`src/react.tsx` imports `@astralbeam/sdk/client` as a [package self-reference](https://nodejs.org/api/packages.html#self-referencing-a-package-using-its-name) that stays external in the build, so both entries load the same chat chunk at runtime.

## Chat widget and host boundary

`mountAstralBeamChat(target, options)` attaches a shadow root to `target` (reusing an existing one — `attachShadow` throws if called twice) and renders the chat widget inside with its CSS as a `<style>` in that root, so styles neither leak out nor inherit in.

Host UI enters via **widgets**, crossing the boundary as [slotted light-DOM children](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_templates_and_slots): at mount the host registers `widgets`, each shaped like a tool definition — a `description`, a `parameters` schema ([Standard Schema](https://standardschema.dev) or plain JSON Schema, forwarded to the agent verbatim; `StandardSchemaV1` is vendored into `src/client.ts`), and `render(props, container)` which may return a cleanup. To render one, the chat widget creates a `<div slot="astralbeam-widget-<name>">` as a light-DOM child of `target`, calls `render` with the agent-chosen props, and renders a matching `<slot>` in the transcript. Widgets thus run in the host's own environment; a slot holds one active render (repeats clean up and replace), and registration happens once at mount.

The React wrapper adapts `render` to JSX by [portaling](https://react.dev/reference/react-dom/createPortal) the host-defined `render(props)` output into the recorded container from the host's React tree, so state, context, and handlers keep working.

## Chat widget styles inside the shadow root

`deno task generate:styles` compiles `src/styles.css` (imports `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`; scans `src/**/*.{ts,tsx}`) with the Tailwind CLI, and `scripts/embed-styles.ts` wraps the output into the checked-in `src/chat/styles.generated.ts` string module — `deno task build` regenerates it; commit it with the source change. Because the sheet lives in a shadow root, theme variables and base styles sit on `:host` instead of `:root`/`body`; the theme block is a copy of the webapp light palette, kept in sync through explicit edits.

## Two-pass build

`tsdown.config.ts` exports two configs run in order by `deno task build`. Pass 1 (`client`) puts `react`/`react-dom` in `deps.alwaysBundle`, producing a self-contained minified `dist/chat-<hash>.js`; everything the chat widget imports is a devDependency so tsdown inlines it (nothing it needs may be in `dependencies`), `define` replaces `process.env.NODE_ENV` with `"production"`, and `alias` maps the shadcn `@/` prefix. Pass 2 (`react`, `vue`, `server`) puts `react`, `react-dom`, and the `@astralbeam/sdk` self-reference in `deps.neverBundle` — wrapper hooks bind to the host React and the self-reference resolves to pass 1's output — with `clean: false` so pass 1's output survives. Both passes: `platform: "neutral"`, `dts: true`; the order matters.

`tsc --noEmit` (`deno task typecheck`) uses the single `tsconfig.json`, whose `paths` maps `@astralbeam/sdk/client` to `./src/client.ts` so the self-reference type-checks against source without a built `dist`.

## Examples and publishing

`examples/` holds standalone consumer apps (own `package.json` and `deno.jsonc`, ignored by knip) depending on `@astralbeam/sdk` via `file:../..`, so they resolve to the built `dist` — run `deno task build` in `sdk` first; `examples/todos` deliberately uses plain CSS to demonstrate the shadow-root boundary. `npm publish` from `sdk` ships only `dist`, `README.md`, `LICENSE`, and `package.json`, with `sideEffects: false` so bundlers drop unused entry points.
