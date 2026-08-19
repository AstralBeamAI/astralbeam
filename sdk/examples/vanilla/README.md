# Vanilla client example

Minimal host page that mounts the AstralBeam chat widget with `mountAstralBeamChat` from `@astralbeam/sdk/client`. The widget renders inside a shadow root for CSS isolation, and the mount target's own children are projected into the widget's `<slot>`.

The Vite config aliases `@astralbeam/sdk/client` to the SDK source in `../../src`, so changes to the SDK show up without a build or publish step.

## Run

```sh
deno install
deno task dev
```
