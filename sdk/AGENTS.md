# SDK development

- `tsdown` is pinned to exactly `0.22.3`: newer versions pull in `rolldown-plugin-dts@^0.27`, whose `yuku` native bindings fail to load under Deno because module load hooks compile `.node` addons as JavaScript ([denoland/deno#36240](https://github.com/denoland/deno/issues/36240)). Re-test the pin once that issue is fixed.
- Each file in `src/` named in `tsdown.config.ts` is a public entry point and maps 1:1 to the `exports` field in `package.json`; add new entry points in both places.
- `react` and `vue` are optional peer dependencies; keep framework imports confined to their respective entry points so consumers of the other entry points never load them.
- The chat widget under `src/widget/` is an internal React app reached only through the dynamic import in `src/client.ts`, never exported directly. `tsdown.config.ts` builds the `client` entry in a separate pass that bundles React into that lazy chunk, so the widget always runs its own React copy independent of the host app. The `react` entry keeps React external (the wrapper must resolve hooks from the host app's React instance) and reaches the widget by self-referencing `@astralbeam/sdk/client`, so both entries share the client pass's single widget chunk.
- Publish with `deno task build` followed by `npm publish` from `sdk`; the package ships only `dist`, `README.md`, `LICENSE`, and `package.json`.
