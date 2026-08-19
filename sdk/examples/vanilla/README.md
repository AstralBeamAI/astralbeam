# Vanilla client example

Minimal host page that mounts the AstralBeam chat widget with `mountAstralBeamChat` from `@astralbeam/sdk/client`. The widget renders inside a shadow root for CSS isolation. The page registers two custom components with descriptions; when the widget requests a render (the agent's decision, stubbed as test renders for now), the page draws the UI as light-DOM children with slot attributes, which the widget projects through named slots. Hostile global styles on the page demonstrate that the widget's own styles stay isolated.

The Vite config aliases `@astralbeam/sdk/client` to the SDK source in `../../src`, so changes to the SDK show up without a build or publish step.

## Run

```sh
deno install
deno task dev
```
