# Brand package

Shared AstralBeam brand assets live here. Logo files are available as SVG masters and generated PNGs under `src/logo`.

## Importing assets

Import assets through the package's exported paths:

```ts
import logoUrl from "@astralbeam/brand/logo/svg/astralbeam-logo-horizontal.svg"
```

## Logo colors

- Treat `packages/ui/src/styles.css` as the source of truth for logo colors.
- Keep the colors in `src/logo/svg/` aligned with the appropriate semantic theme value instead of introducing independent hex colors.
- The default logo color is the light theme's `--foreground` value.
- When a theme foreground changes, update every logo SVG that embeds that value.

## Generated PNGs

- SVG files in `src/logo/svg/` are the logo masters.
- After changing a logo SVG, regenerate all PNG variants with `vp run @astralbeam/brand#generate:png`.
- Commit the regenerated files in `src/logo/png/` with their SVG sources.
- Set `SCALE` to generate higher-resolution PNGs, for example `SCALE=2 vp run @astralbeam/brand#generate:png`.
- The generator accepts an asset-group name and defaults to `logo`; use `vp run @astralbeam/brand#generate:png logo` to pass it explicitly.
