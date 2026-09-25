import type { CSSProperties } from "react"

const widgetThemeTokens = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
]
// Resolve aliases outside the shadow root, where the dashboard owns these tokens.
export const widgetThemeStyle = Object.fromEntries(
  widgetThemeTokens.map((token) => [`--dashboard-${token}`, `var(--${token})`]),
) as CSSProperties
// The dashboard fonts are Tailwind theme values rather than runtime variables.
export const widgetThemeClassName =
  "[--dashboard-font-heading:--theme(--font-heading)] [--dashboard-font-sans:--theme(--font-sans)]"
export const widgetDashboardTheme = {
  light: {
    ...Object.fromEntries(
      widgetThemeTokens.map((token) => [`--${token}`, `var(--dashboard-${token})`]),
    ),
    "--radius": "0px",
    "--radius-sm": "0px",
    "--radius-md": "0px",
    "--font-sans": "var(--dashboard-font-sans)",
    "--font-heading": "var(--dashboard-font-heading)",
  },
}
