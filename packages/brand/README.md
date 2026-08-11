# `@astralbeam/brand`

The shared semantic palette and approved AstralBeam logo assets are exposed as CSS, SVG masters, and generated PNGs:

```text
@astralbeam/brand/colors.css
@astralbeam/brand/theme
@astralbeam/brand/logo/svg/*
@astralbeam/brand/logo/png/*
```

```css
@import "@astralbeam/brand/colors.css";
```

Apply exactly one theme class to a root or ancestor before the page first paints:

```html
<html class="light"></html>
```

Use `dark` instead of `light` for the dark palette.

Node-only consumers can use the complete resolved theme directly:

```ts
import { theme } from "@astralbeam/brand/theme"

const background = theme.palette.dark.background.srgbHex
const radius = theme.radius
```

```ts
import darkWordmarkUrl from "@astralbeam/brand/logo/svg/astralbeam-wordmark-dark.svg"
import lightLogoUrl from "@astralbeam/brand/logo/svg/astralbeam-logo-light.svg"
import lightWordmarkUrl from "@astralbeam/brand/logo/svg/astralbeam-wordmark-light.svg"
```

Use the square `astralbeam-logo-light` and `astralbeam-logo-dark` variants, which place the A and B initials side by side, for icons and compact placements. Use the horizontal `astralbeam-wordmark-light` and `astralbeam-wordmark-dark` variants where the full name belongs. The suffix describes the intended background, and every master has a transparent canvas.

Semantic light and dark colors plus the shared radius are published under the explicit `.light` and `.dark` selectors in `colors.css`. Standalone SVGs embed resolved sRGB paints for renderer compatibility. Node-only build tools can use the complete `theme`, its `palette`, or resolve an individual color with `resolveBrandColor` from `@astralbeam/brand/theme`; that export is blocked by the package's browser condition.
