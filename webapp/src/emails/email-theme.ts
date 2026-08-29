// Adapted with: deno task ui add @emailcn/react-email/theme-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06:registry/bases/react-email/themes/email-theme.ts
// Local changes: Resolve the app's light brand palette to static sRGB email tokens, use system fonts, and expose matching class names only.

import { pixelBasedPreset, type TailwindConfig } from "react-email"

import { palette, theme } from "../theme/brand.ts"

const EMAIL_ROOT_FONT_SIZE_PX = 16

const emailTheme = {
  colors: {
    background: palette.light.background.srgbHex,
    border: palette.light.border.srgbHex,
    card: palette.light.card.srgbHex,
    foreground: palette.light.foreground.srgbHex,
    muted: palette.light.muted.srgbHex,
    mutedForeground: palette.light.mutedForeground.srgbHex,
    primary: palette.light.primary.srgbHex,
    primaryForeground: palette.light.primaryForeground.srgbHex,
  },
  containerWidth: "600px",
  fontFamily: [
    "-apple-system",
    "BlinkMacSystemFont",
    '"Segoe UI"',
    "Arial",
    "sans-serif",
  ],
  radius: resolveEmailRadius(theme.geometry.radius),
} as const

export const emailTailwindConfig = {
  presets: [pixelBasedPreset],
  theme: {
    extend: {
      borderRadius: {
        brand: emailTheme.radius,
      },
      colors: {
        background: emailTheme.colors.background,
        border: emailTheme.colors.border,
        card: emailTheme.colors.card,
        foreground: emailTheme.colors.foreground,
        muted: emailTheme.colors.muted,
        "muted-foreground": emailTheme.colors.mutedForeground,
        primary: emailTheme.colors.primary,
        "primary-foreground": emailTheme.colors.primaryForeground,
      },
      fontFamily: {
        sans: emailTheme.fontFamily,
      },
      maxWidth: {
        email: emailTheme.containerWidth,
      },
    },
  },
} satisfies TailwindConfig

function resolveEmailRadius(radius: string): string {
  if (radius === "0") return "0px"

  const match = /^(\d+(?:\.\d+)?)(px|rem|em|%)$/.exec(radius)
  if (!match) {
    throw new Error(`Email theme radius must use px, rem, em, or %; received '${radius}'`)
  }
  if (match[2] === "%") return radius
  const value = Number(match[1])
  const pixels = match[2] === "px" ? value : value * EMAIL_ROOT_FONT_SIZE_PX
  return `${Math.round(pixels)}px`
}
