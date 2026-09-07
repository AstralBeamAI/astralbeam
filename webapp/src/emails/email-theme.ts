// Adapted with: deno task ui add @emailcn/react-email/theme-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06:registry/bases/react-email/themes/email-theme.ts
// Local changes: Inline the app's light brand palette as static sRGB email tokens, use system fonts, and expose matching class names only.

import { pixelBasedPreset, type TailwindConfig } from "react-email"

// Email clients need static sRGB, so these are the light `src/theme/brand.json` roles resolved to
// hex and `--radius` in pixels. Refresh them from what `deno task generate:theme` prints.
const emailTheme = {
  colors: {
    background: "#f7fcfb",
    border: "#dee5e4",
    card: "#ffffff",
    foreground: "#07191d",
    muted: "#ecf2f1",
    mutedForeground: "#637171",
    primary: "#0c7a69",
    primaryForeground: "#f7fcfb",
  },
  containerWidth: "600px",
  fontFamily: [
    "-apple-system",
    "BlinkMacSystemFont",
    '"Segoe UI"',
    "Arial",
    "sans-serif",
  ],
  radius: "7px",
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
