import stylesheet from "@astralbeam/ui/styles.css?raw"

function readThemeToken(selector: ":root" | ".dark", token: string) {
  const block = stylesheet.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1]
  const value = block?.match(new RegExp(`--${token}:\\s*([^;]+);`))?.[1]?.trim()

  if (!value) {
    throw new Error(`Missing ${selector} --${token} theme token`)
  }

  return value
}

export const darkTheme = {
  background: readThemeToken(".dark", "background"),
  foreground: readThemeToken(".dark", "foreground"),
  card: readThemeToken(".dark", "card"),
  primary: readThemeToken(".dark", "primary"),
  muted: readThemeToken(".dark", "muted"),
  mutedForeground: readThemeToken(".dark", "muted-foreground"),
  border: readThemeToken(".dark", "border"),
} as const

export const darkThemeSrgb = {
  background: oklchToHex(darkTheme.background),
  foreground: oklchToHex(darkTheme.foreground),
  card: oklchToHex(darkTheme.card),
  primary: oklchToHex(darkTheme.primary),
  muted: oklchToHex(darkTheme.muted),
  mutedForeground: oklchToHex(darkTheme.mutedForeground),
  border: oklchToHex(darkTheme.border),
} as const

function oklchToHex(color: string) {
  const match = color.match(
    /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%?)?\s*\)$/,
  )

  if (!match) {
    throw new Error(`Unsupported theme color: ${color}`)
  }

  const lightness = Number(match[1])
  const chroma = Number(match[2])
  const hue = (Number(match[3]) * Math.PI) / 180
  const alpha = match[4] ? Number(match[4]) / (color.includes("%") ? 100 : 1) : 1
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const hex = channels
    .map((channel) => {
      const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
      return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
        .toString(16)
        .padStart(2, "0")
    })
    .join("")
  const alphaHex =
    alpha < 1
      ? Math.round(Math.min(1, Math.max(0, alpha)) * 255)
          .toString(16)
          .padStart(2, "0")
      : ""

  return `#${hex}${alphaHex}`
}
