# SDK development

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) before touching entry points, the widget, or the build, and update it in the same commit whenever that structure changes.
- Explain structural and build decisions in `ARCHITECTURE.md` rather than in long code comments; keep an inline comment to what is specific to that line.
- `tsdown` is pinned to exactly `0.22.3`: newer versions pull in `rolldown-plugin-dts@^0.27`, whose `yuku` native bindings fail to load under Deno because module load hooks compile `.node` addons as JavaScript ([denoland/deno#36240](https://github.com/denoland/deno/issues/36240)). Re-test the pin once that issue is fixed.
- Each file in `src/` named in `tsdown.config.ts` is a public entry point and maps 1:1 to the `exports` field in `package.json`; add new entry points in both places.
- `react` and `vue` are optional peer dependencies; keep framework imports confined to their respective entry points so consumers of the other entry points never load them.
- Never export the widget under `src/widget/` or reach it by any route other than the dynamic import in `src/client.ts`, so it stays inside the client pass's lazy chunk with its own bundled React.
- Everything the widget imports must be a devDependency so tsdown inlines it into the widget chunk; adding it to `dependencies` would force hosts to install it.
- Generate shadcn components with `deno task ui add <component>`; never edit `src/components/ui` beyond minimal typed fixups, and keep `components.json` aligned with webapp's style, base color, and icon library.
- Never edit `src/widget/styles.generated.ts`; regenerate it with `deno task generate:styles` (also run by `build`) after changing `src/styles.css` or any Tailwind classes, and commit it with the change.
- Keep `examples/*` standalone consumer apps on the built `dist` via their `file:../..` dependency, with no Tailwind or shadcn of their own, so they keep demonstrating the shadow-root style boundary.
- Publish with `deno task build` followed by `npm publish` from `sdk`; the package ships only `dist`, `README.md`, `LICENSE`, and `package.json`.
