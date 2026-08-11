import { convert } from "@asamuzakjp/css-color"
import { readFileSync } from "node:fs"

export type BrandTheme = "light" | "dark"

export interface ResolvedBrandColor {
  readonly css: string
  readonly srgb: readonly [number, number, number]
  readonly srgbHex: `#${string}`
}

const stylesheet = readFileSync(
  new URL(import.meta.resolve("@astralbeam/brand/colors.css")),
  "utf8",
)
const themeSelectors = {
  light: ".light",
  dark: ".dark",
} as const satisfies Record<BrandTheme, string>

export function resolveBrandColor(theme: BrandTheme, token: string): ResolvedBrandColor {
  const selector = themeSelectors[theme]
  const block = stylesheet.match(
    new RegExp(`(?:^|\\})\\s*${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "u"),
  )?.[1]
  const css = block
    ?.match(new RegExp(`(?:^|[\\r\\n])\\s*--${escapeRegExp(token)}:\\s*([^;]+);`, "u"))?.[1]
    ?.trim()

  if (!css) {
    throw new Error(`Missing ${selector} --${token} brand color`)
  }

  const convertedHex = convert.colorToHex(css)
  const alpha = convert.colorToRgb(css)[3]

  if (!convertedHex || !isSrgbHex(convertedHex) || alpha !== 1) {
    throw new Error(`Unsupported brand color: ${css}`)
  }

  const srgbHex = convertedHex
  const srgb = [
    Number.parseInt(srgbHex.slice(1, 3), 16),
    Number.parseInt(srgbHex.slice(3, 5), 16),
    Number.parseInt(srgbHex.slice(5, 7), 16),
  ] as const

  return {
    css,
    srgb,
    srgbHex,
  }
}

function resolvePalette(theme: BrandTheme) {
  const resolve = (token: string) => resolveBrandColor(theme, token)

  return {
    background: resolve("background"),
    foreground: resolve("foreground"),
    card: resolve("card"),
    cardForeground: resolve("card-foreground"),
    popover: resolve("popover"),
    popoverForeground: resolve("popover-foreground"),
    primary: resolve("primary"),
    primaryForeground: resolve("primary-foreground"),
    secondary: resolve("secondary"),
    secondaryForeground: resolve("secondary-foreground"),
    muted: resolve("muted"),
    mutedForeground: resolve("muted-foreground"),
    accent: resolve("accent"),
    accentForeground: resolve("accent-foreground"),
    destructive: resolve("destructive"),
    warning: resolve("warning"),
    border: resolve("border"),
    input: resolve("input"),
    ring: resolve("ring"),
    chart1: resolve("chart-1"),
    chart2: resolve("chart-2"),
    chart3: resolve("chart-3"),
    chart4: resolve("chart-4"),
    chart5: resolve("chart-5"),
    sidebar: resolve("sidebar"),
    sidebarForeground: resolve("sidebar-foreground"),
    sidebarPrimary: resolve("sidebar-primary"),
    sidebarPrimaryForeground: resolve("sidebar-primary-foreground"),
    sidebarAccent: resolve("sidebar-accent"),
    sidebarAccentForeground: resolve("sidebar-accent-foreground"),
    sidebarBorder: resolve("sidebar-border"),
    sidebarRing: resolve("sidebar-ring"),
  } as const
}

export type ResolvedBrandPalette = ReturnType<typeof resolvePalette>

export const palette = {
  light: resolvePalette("light"),
  dark: resolvePalette("dark"),
} as const satisfies Readonly<Record<BrandTheme, ResolvedBrandPalette>>

export const theme = {
  palette,
  radius: resolveSharedBrandToken("radius"),
} as const

function resolveSharedBrandToken(token: string) {
  const pattern = new RegExp(`(?:^|[\\r\\n])\\s*--${escapeRegExp(token)}:\\s*([^;]+);`, "gu")
  const values = [...stylesheet.matchAll(pattern)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))

  if (values.length !== 1) {
    throw new Error(`Expected one shared --${token} brand token; found ${values.length}`)
  }

  return values[0]
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function isSrgbHex(value: string): value is `#${string}` {
  return /^#[\da-f]{6}$/u.test(value)
}
