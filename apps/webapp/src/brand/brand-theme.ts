import { resolveThemeDefinition, resolveThemePalette } from "@astralbeam/theme"

import themeDefinition from "./theme.json" with { type: "json" }

const resolvedTheme = resolveThemeDefinition(themeDefinition)

export const theme = Object.freeze({
  colors: Object.freeze({
    light: Object.freeze(resolvedTheme.colors.light),
    dark: Object.freeze(resolvedTheme.colors.dark),
  }),
  geometry: Object.freeze(resolvedTheme.geometry),
})

export const palette = Object.freeze({
  light: resolveThemePalette(theme, "light"),
  dark: resolveThemePalette(theme, "dark"),
})
