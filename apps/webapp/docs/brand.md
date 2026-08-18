# `@astralbeam/webapp/brand`

The shared semantic palette and approved AstralBeam logo assets are exposed as CSS, SVG masters, and generated PNGs:

```text
@astralbeam/webapp/brand/colors.css
@astralbeam/webapp/brand
@astralbeam/webapp/brand/logo/svg/*
@astralbeam/webapp/brand/logo/png/*
```

```css
@import "@astralbeam/webapp/brand/colors.css";
```

Apply exactly one theme class to a root or ancestor before the page first paints:

```html
<html class="light"></html>
```

Use `dark` instead of `light` for the dark palette.

Tools that need the resolved AstralBeam brand theme can import its validated document. Static applications should prefer the generated stylesheet so the authoring validator and color math stay out of their ordinary client bundle.

```ts
import { theme } from "@astralbeam/webapp/brand"

const radius = theme.geometry.radius
```

Consumers that need resolved sRGB values can use the concrete AstralBeam palette, which is materialized by the webapp's generic theme converter:

```ts
import { palette } from "@astralbeam/webapp/brand"

const background = palette.dark.background.srgbHex
```

```ts
import darkWordmarkUrl from "@astralbeam/webapp/brand/logo/svg/astralbeam-wordmark-dark.svg"
import lightLogoUrl from "@astralbeam/webapp/brand/logo/svg/astralbeam-logo-light.svg"
import lightWordmarkUrl from "@astralbeam/webapp/brand/logo/svg/astralbeam-wordmark-light.svg"
```

Use the square `astralbeam-logo-light` and `astralbeam-logo-dark` variants, which place the A and B initials side by side, for icons and compact placements. Use the horizontal `astralbeam-wordmark-light` and `astralbeam-wordmark-dark` variants where the full name belongs. The suffix describes the intended background, and every master has a transparent canvas.

Edit `apps/webapp/src/brand/theme.json`, then run `vp run @astralbeam/webapp#generate:colors` and commit both the definition and checked-in stylesheet. Do not edit `colors.css` directly; Brand tests fail when it drifts from the JSON source.

Only `colors.light.primary` is required; omitted roles are derived by `apps/webapp/src/theme/theme.ts`. The `$schema` URL provides editor validation and completion. Standalone SVG and PNG paints are independent of semantic theme generation.

Reusable color conversion belongs to the neutral Theme module; `theme` and `palette` are the concrete AstralBeam bindings exported from the private webapp workspace.
