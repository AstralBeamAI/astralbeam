# React example

Minimal React host app that renders the AstralBeam chat widget through `<AstralBeamChat>` from `@astralbeam/sdk/react`. The example registers a `StatusCard` and a stateful `CounterCard` through the `customComponents` prop; the widget requests renders (the agent's decision, stubbed as test renders for now), and the components run in the host app's React tree while being projected into the widget through slots. Hostile global styles on the page demonstrate that the widget's own styles stay isolated.

This example consumes the built package: `@astralbeam/sdk` is a `file:` dependency on the parent SDK project (`../..`), so imports resolve through the package's `exports` field into `dist` and exercise the published chunk layout, including the widget's own bundled React copy. The `dev` and `build` tasks rebuild the SDK first; re-run them to pick up SDK source changes. For buildless source-level iteration, use the vanilla example instead, which compiles the SDK from source.

## Run

```sh
deno install
deno task dev
```
