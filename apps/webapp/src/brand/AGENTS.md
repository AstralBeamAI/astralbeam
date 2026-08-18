# Brand package

Shared AstralBeam brand assets live here. The four SVG masters and their generated PNGs cover light- and dark-background square logos and horizontal wordmarks under `src/logo`.

## Theme

- Treat the compact `src/theme.json` definition as the source of truth: author optional semantic values under `colors.light`, optional `background`, `foreground`, `primary`, and `accent` values under `colors.dark`, and shared dimensions under `geometry`; every other dark role is derived.
- Generate and commit `src/colors.css` with `vp run @astralbeam/brand#generate:colors`; do not edit the generated stylesheet directly. Brand tests fail when it drifts from `src/theme.json`.
- Keep `colors.css`, `theme`, and `palette` browser-safe; prefer the generated stylesheet for static applications, and import the exhaustive document and resolved sRGB values from `@astralbeam/brand`. Generic conversion belongs to `@astralbeam/theme`.
- Keep the resolved brand theme exhaustive and symmetric with the shared semantic contract; retain an optional authored role only when its value intentionally differs from the resolver default.
- Keep theme-invariant values such as radius under `geometry` so generation emits them once under the combined `.light, .dark` selector and `theme` exposes them once.
- Require every CSS consumer to apply exactly one of `.light` or `.dark` to a root or ancestor before first paint.

## Logo colors

- Keep the `data-theme-token` markers on each SVG's `foreground` and `primary` paint group.
- Treat logo paints as approved standalone asset colors independent of theme generation; do not change SVG or PNG paints when semantic theme colors change.
- Keep each light/dark pair transparent and geometrically identical.

## Geometry

- Keep SVG masters path-only; convert lettering to vector paths instead of adding font-dependent `<text>` elements.
- Preserve the accepted rounded `ASTRAL` terminals, sharp `BEAM` terminals, shared stroke weight, and letter spacing in both variants.
- Keep equal 18-unit padding on every side of each wordmark, matching the median gap between adjacent letters.
- Keep the square-logo A and B on the same cap line and baseline with that same 18-unit gap, centered together in the square canvas.
- Build each square logo from the accepted A and B paths without altering either glyph.

## Generated PNGs

- SVG files in `src/logo/svg/` are the logo masters.
- After changing an SVG, regenerate all PNG variants with `vp run @astralbeam/brand#generate:png`.
- Commit the generated files in `src/logo/png/` with their SVG sources.
- Set `SCALE` for higher-resolution PNGs, for example `SCALE=2 vp run @astralbeam/brand#generate:png`.
- The generator accepts an asset-group name and defaults to `logo`; use `vp run @astralbeam/brand#generate:png logo` to pass it explicitly.
