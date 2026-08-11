# Brand package

Shared AstralBeam brand assets live here. The four SVG masters and their generated PNGs cover light- and dark-background square logos and horizontal wordmarks under `src/logo`.

## Logo colors

- Treat `src/colors.css` as the repository's source of truth for semantic brand colors and shared theme dimensions such as radius.
- Keep `colors.css` browser-safe and token-only; Node consumers that need resolved sRGB values must use the complete `palette` or `resolveBrandColor` from the browser-blocked `@astralbeam/brand/theme` export.
- Keep both exported palette themes exhaustive and symmetric with the semantic tokens in `colors.css`.
- Keep theme-invariant tokens declared once under the combined `.light, .dark` selector and exposed through the `theme` export.
- Require every CSS consumer to apply exactly one of `.light` or `.dark` to a root or ancestor before first paint.
- Keep the `data-theme-token` markers on each SVG's `foreground` and `primary` paint group.
- Manually keep every marked `color` attribute equal to the resolved sRGB hex value of its matching token in `colors.css`: use `.light` for `-light` SVGs and `.dark` for `-dark` SVGs.
- When either token changes, update both affected SVG variants before regenerating PNGs; the PNG generator renders the checked-in SVGs without changing their colors.
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
