# SDK architecture

High-level map of `@astralbeam/sdk`: entry points, the embedded chat widget, the shadow-root/slot host boundary, the styles pipeline, and the two-pass build. Details live in the referenced files.

## Entry points

- Each file directly under `src/` named in `tsdown.config.ts` is a public entry point, mapped 1:1 to a subpath in `package.json` `exports`; there is no root export.

| Entry point              | Source          | Contents                                             | Peer dependency                 |
| ------------------------ | --------------- | ---------------------------------------------------- | ------------------------------- |
| `@astralbeam/sdk/client` | `src/client.ts` | `mountAstralBeamChat`, the framework-agnostic loader | none                            |
| `@astralbeam/sdk/react`  | `src/react.tsx` | `<AstralBeamChat>` wrapper                           | `react`, `react-dom` (optional) |
| `@astralbeam/sdk/vue`    | `src/vue.ts`    | Vue components (placeholder)                         | `vue` (optional)                |
| `@astralbeam/sdk/server` | `src/server.ts` | Server helpers (placeholder)                         | none                            |

- Framework peers are optional and confined to their own entry point. Everything else is internal: `src/chat/` is reached only via the dynamic `import()` in `src/client.ts`, `src/components/ui` and `src/lib` are shadcn-generated, and `src/styles.css` is the Tailwind input, not an entry point.

## The embedded React chat widget

- The host page may lack React or run an incompatible version, so the chat widget bundles its own React into a lazily loaded chunk, and every path goes through `mountAstralBeamChat`.
- Vanilla hosts call it directly (`dist/client.js` carries no React); React hosts render `<AstralBeamChat>`, whose hooks run on the _host's_ React ([invalid hook call](https://react.dev/warnings/invalid-hook-call-warning)) and which mounts the widget from an effect. Two React instances coexist by design, sharing no hooks, context, or reconciler state.
- The UI is Tailwind v4 plus shadcn/ui components in `src/components/ui` (`deno task ui add <component>`; `components.json` matches webapp's style, base color, and icons).
- Chat state runs on TanStack AI's `useChat`, streaming over `fetchServerSentEvents` from the `endpoint` option (default `/api/chat`, served by the webapp), with the `systemPrompt` option forwarded in the AG-UI `forwardedProps` for the endpoint to append to the agent's instructions.
- Every tool is a client tool built in `src/chat/agent.ts` and executed in the host page; the connection declares them (schemas converted to JSON Schema) in the AG-UI request body, so the endpoint needs no per-host configuration. Two are SDK-defined and interpreted by `src/chat/chat-widget.tsx`: `render_widget` carries a catalog of the registered widgets in its description and renders one into a slotted container when executed, and `ask_questionnaire` (an inline multi-step questionnaire) is deliberately execute-less — the tool call stays pending until the user submits, and `addToolResult` returns the answers as the tool output and resumes the run. Host tools from the `tools` mount option wrap the host's `execute` with client-side Standard Schema validation of the agent-chosen input.
- A run input holding an unresolved tool call never reaches the model: the endpoint re-offers the pending tool and finishes the run, leaving the user's message unanswered. The composer therefore treats executing host tools as busy (alongside `submitted`/`streaming`, when it swaps the send button for a stop button), and a send settles every dangling call first: pending questionnaires resolve as `{ answers: [], skipped: true }` and calls to tools the mount never implemented resolve as tool errors. Agent-supplied content that fails to render degrades per part (questionnaire items are sanitized; a per-part error boundary catches the rest) instead of unmounting the chat.
- `src/react.tsx` imports `@astralbeam/sdk/client` as a [package self-reference](https://nodejs.org/api/packages.html#self-referencing-a-package-using-its-name) that stays external in the build, so both entries load the same chat chunk at runtime.

## Chat widget and host boundary

- `mountAstralBeamChat(target, options)` attaches a shadow root to `target` (reusing an existing one — `attachShadow` throws if called twice), creates the widget container `<div>` inside it, and renders the chat widget into that container with its CSS as a `<style>` in the root, so styles neither leak out nor inherit in.
- The loader owns the container because theming is container-level DOM work that must not wait for the lazy chunk: the `theme` option (`"light" | "dark" | "system"`, default `"system"`) and the handle's `setTheme` toggle a `.dark` class on it, with `"system"` resolved through a `matchMedia("(prefers-color-scheme: dark)")` listener that re-applies on OS changes and is removed on unmount. The React wrapper exposes this as a `theme` prop and forwards changes to `setTheme` from an effect.
- Host UI enters via **widgets**, crossing the boundary as [slotted light-DOM children](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_templates_and_slots).
- Each widget definition is shaped like a tool definition: a `description`, a `parameters` schema ([Standard Schema](https://standardschema.dev) or plain JSON Schema, declared to the agent as JSON Schema; `StandardSchemaV1` is vendored into `src/client.ts`), and `render(props, container)`, which may return a cleanup. Host tools from the `tools` option share the same `description`/`parameters` shape with an `execute` instead of `render`. Agent-supplied input is untrusted, so widget lookups guard against inherited object keys and a Standard Schema `parameters` validates the input before host code runs.
- To render one, the chat widget creates a `<div slot="astralbeam-widget-<toolCallId>">` as a light-DOM child of `target`, calls `render` with the agent-chosen props, and renders a matching `<slot>` in the transcript. Slot names are per tool call because slot assignment projects into the first matching `<slot>` in tree order — naming them per widget would send a repeated render into the oldest transcript entry.
- Widgets thus run in the host's own environment; a widget holds one active render (a repeated request cleans up and replaces, and the superseded transcript entry collapses to a summary marker), and registration happens once at mount.
- The React wrapper adapts `render` to JSX by [portaling](https://react.dev/reference/react-dom/createPortal) the host-defined `render(props)` output into the recorded container from the host's React tree, so state, context, and handlers keep working.

## Chat widget styles inside the shadow root

- `deno task generate:styles` compiles `src/styles.css` (imports `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`; scans `src/**/*.{ts,tsx}`) with the Tailwind CLI, and `scripts/embed-styles.ts` wraps the output into the checked-in `src/chat/styles.generated.ts` string module — `deno task build` regenerates it; commit it with the source change.
- Because the sheet lives in a shadow root, theme variables and base styles sit on `:host` instead of `:root`/`body`; the theme blocks are copies of the webapp light and dark palettes, kept in sync through explicit edits.
- Dark mode is class-based: the dark palette lives on `.dark` and `@custom-variant dark (&:is(.dark *))` rebinds Tailwind's `dark:` utilities to it, because a `.dark` on a light-DOM ancestor (the webapp convention) can never match inside the shadow root. The loader toggles that class on the widget container (see the theming bullet above), and `color-scheme` is set per mode so native controls and scrollbars ignore the host page's scheme.

## Two-pass build

- `tsdown.config.ts` exports two configs run in order by `deno task build`. Pass 1 (`client`) puts `react`/`react-dom` in `deps.alwaysBundle`, producing a self-contained minified `dist/chat-<hash>.js`; everything the chat widget imports is a devDependency so tsdown inlines it (nothing it needs may be in `dependencies`), `define` replaces `process.env.NODE_ENV` with `"production"`, and `alias` maps the shadcn `@/` prefix.
- Pass 2 (`react`, `vue`, `server`) puts `react`, `react-dom`, and the `@astralbeam/sdk` self-reference in `deps.neverBundle` — wrapper hooks bind to the host React and the self-reference resolves to pass 1's output — with `clean: false` so pass 1's output survives. Both passes: `platform: "neutral"`, `dts: true`; the order matters.
- `tsc --noEmit` (`deno task typecheck`) uses the single `tsconfig.json`, whose `paths` maps `@astralbeam/sdk/client` to `./src/client.ts` so the self-reference type-checks against source without a built `dist`.

## Examples and publishing

- `examples/` holds standalone consumer apps (own `package.json` and `deno.jsonc`, ignored by knip) depending on `@astralbeam/sdk` via `file:../..`, so they resolve to the built `dist` — run `deno task build` in `sdk` first; `examples/todos` deliberately uses plain CSS to demonstrate the shadow-root boundary, themes both the app and the widget's `theme` prop from one system/light/dark preference, and drives a real agent through the webapp's `/api/chat` with a system prompt, todo tools over live React state, and the `todoCard` widget.
- `npm publish` from `sdk` ships only `dist`, `README.md`, `LICENSE`, and `package.json`, with `sideEffects: false` so bundlers drop unused entry points.
