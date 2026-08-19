# SDK development

- `tsdown` is pinned to exactly `0.22.3`: newer versions pull in `rolldown-plugin-dts@^0.27`, whose `yuku` native bindings fail to load under Deno because module load hooks compile `.node` addons as JavaScript ([denoland/deno#36240](https://github.com/denoland/deno/issues/36240)). Re-test the pin once that issue is fixed.
- Each file in `src/` named in `tsdown.config.ts` is a public entry point and maps 1:1 to the `exports` field in `package.json`; add new entry points in both places.
- `react` and `vue` are optional peer dependencies; keep framework imports confined to their respective entry points so consumers of the other entry points never load them.
- Publish with `deno task build` followed by `npm publish` from `sdk`; the package ships only `dist`, `README.md`, `LICENSE`, and `package.json`.
