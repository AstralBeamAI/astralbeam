import { generateThemeCss, resolveThemeDefinition } from "./theme.ts"

import brandDefinition from "../../src/theme/brand.json" with { type: "json" }

const sectionStartMarker = "/* Generated theme variables: start */\n"
const sectionEndMarker = "/* Generated theme variables: end */"

export const brandTheme = resolveThemeDefinition(brandDefinition)

/** Replaces the marked generated section of `src/styles.css` with the compiled brand theme. */
export function updateThemeStylesheet(stylesheet: string): string {
  const sectionStart = stylesheet.indexOf(sectionStartMarker)
  const sectionEnd = stylesheet.indexOf(sectionEndMarker, sectionStart + sectionStartMarker.length)

  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error("styles.css is missing the generated theme variable markers")
  }

  return [
    stylesheet.slice(0, sectionStart + sectionStartMarker.length),
    generateThemeCss(brandTheme),
    stylesheet.slice(sectionEnd),
  ].join("")
}
