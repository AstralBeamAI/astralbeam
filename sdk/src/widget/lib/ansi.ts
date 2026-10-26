import { createColorPalette, parseAnsiSequences } from "ansi-sequence-parser"
import type { CSSProperties } from "react"

// Retain the previous GitHub terminal palette in both widget color schemes.
const palette = createColorPalette({
  black: "light-dark(#24292e, #586069)",
  red: "light-dark(#d73a49, #ea4a5a)",
  green: "light-dark(#28a745, #34d058)",
  yellow: "light-dark(#dbab09, #ffea7f)",
  blue: "light-dark(#0366d6, #2188ff)",
  magenta: "light-dark(#5a32a3, #b392f0)",
  cyan: "light-dark(#1b7c83, #39c5cf)",
  white: "light-dark(#6a737d, #d1d5da)",
  brightBlack: "#959da5",
  brightRed: "light-dark(#cb2431, #f97583)",
  brightGreen: "light-dark(#22863a, #85e89d)",
  brightYellow: "light-dark(#b08800, #ffea7f)",
  brightBlue: "light-dark(#005cc5, #79b8ff)",
  brightMagenta: "light-dark(#5a32a3, #b392f0)",
  brightCyan: "light-dark(#3192aa, #56d4dd)",
  brightWhite: "light-dark(#d1d5da, #fafbfc)",
})

export function ansiTokens(code: string) {
  return parseAnsiSequences(code).map(({ value, foreground, background, decorations }) => {
    let color = foreground ? palette.value(foreground) : "var(--th-token)"
    let backgroundColor = background ? palette.value(background) : undefined
    if (decorations.has("reverse")) {
      backgroundColor = color
      color = background ? palette.value(background) : "var(--th-background)"
    }
    const style: CSSProperties = {
      color: decorations.has("dim") ? `color-mix(in srgb, ${color} 50%, transparent)` : color,
      backgroundColor,
      fontWeight: decorations.has("bold") ? "bold" : undefined,
      fontStyle: decorations.has("italic") ? "italic" : undefined,
      textDecoration:
        [
          decorations.has("underline") && "underline",
          decorations.has("strikethrough") && "line-through",
        ]
          .filter(Boolean)
          .join(" ") || undefined,
    }
    return { value, style }
  })
}
