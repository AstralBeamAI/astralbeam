// Added with: deno task ui add @better-auth-ui/email-verification-email
// Local changes: Move into the email delivery domain, derive email-safe colors and typography from the app's semantic shadcn theme, accept explicit undefined values under strict optional typing, and keep style internals module-private.

import { pixelBasedPreset } from "react-email"

import { palette } from "../theme/brand.ts"

const defaultColors = {
  light: {
    background: palette.light.background.srgbHex,
    border: palette.light.border.srgbHex,
    card: palette.light.card.srgbHex,
    cardForeground: palette.light.cardForeground.srgbHex,
    foreground: palette.light.foreground.srgbHex,
    muted: palette.light.muted.srgbHex,
    mutedForeground: palette.light.mutedForeground.srgbHex,
    primary: palette.light.primary.srgbHex,
    primaryForeground: palette.light.primaryForeground.srgbHex,
  },
  dark: {
    background: palette.dark.background.srgbHex,
    border: palette.dark.border.srgbHex,
    card: palette.dark.card.srgbHex,
    cardForeground: palette.dark.cardForeground.srgbHex,
    foreground: palette.dark.foreground.srgbHex,
    muted: palette.dark.muted.srgbHex,
    mutedForeground: palette.dark.mutedForeground.srgbHex,
    primary: palette.dark.primary.srgbHex,
    primaryForeground: palette.dark.primaryForeground.srgbHex,
  },
}

/** Inline the light semantic theme for clients that strip media-query styles. */
export const emailTailwindConfig = {
  presets: [pixelBasedPreset],
  theme: {
    extend: {
      colors: {
        background: defaultColors.light.background,
        border: defaultColors.light.border,
        card: defaultColors.light.card,
        "card-foreground": defaultColors.light.cardForeground,
        foreground: defaultColors.light.foreground,
        muted: defaultColors.light.muted,
        "muted-foreground": defaultColors.light.mutedForeground,
        primary: defaultColors.light.primary,
        "primary-foreground": defaultColors.light.primaryForeground,
      },
      fontFamily: {
        heading: ["Manrope", "Inter", "Arial", "sans-serif"],
        sans: ["Inter", "Arial", "sans-serif"],
      },
    },
  },
}

/**
 * Custom CSS class names for styling different parts of email templates.
 *
 * Allows fine-grained control over the appearance of email components.
 */
export type EmailClassNames = {
  body?: string
  container?: string
  card?: string
  logo?: string
  title?: string
  content?: string
  button?: string
  description?: string
  separator?: string
  link?: string
  poweredBy?: string
  codeBlock?: string
}

/**
 * Custom color scheme configuration for email templates.
 *
 * Supports separate color definitions for light and dark modes.
 * Any color not specified will fall back to the defaultColors values.
 */
export type EmailColors = {
  light?: Partial<typeof defaultColors.light>
  dark?: Partial<typeof defaultColors.dark>
}

/**
 * Props for the EmailStyles component.
 */
interface EmailStylesProps {
  /** Custom color scheme for light and dark modes */
  colors?: EmailColors | undefined
  /** Whether to enable dark mode support */
  darkMode?: boolean | undefined
}

/**
 * Component that injects CSS styles for email templates with support for light and dark modes.
 *
 * Generates inline styles that adapt to the user's color scheme preference and applies
 * custom colors if provided. Handles logo visibility switching between light and dark modes.
 *
 * @param props - Style configuration options
 * @returns A style element containing CSS for email template theming
 *
 * @example
 * ```tsx
 * <EmailStyles
 *   colors={{
 *     light: { primary: "#000000" },
 *     dark: { primary: "#FFFFFF" }
 *   }}
 *   darkMode={true}
 * />
 * ```
 */
export const EmailStyles = ({ colors, darkMode = true }: EmailStylesProps) => {
  return (
    <style type="text/css">
      {`
      .email-bg-background {
        background-color: ${colors?.light?.background || defaultColors.light.background} !important;
      }
      .email-bg-card {
        background-color: ${colors?.light?.card || defaultColors.light.card} !important;
      }
      .email-bg-primary {
        background-color: ${colors?.light?.primary || defaultColors.light.primary} !important;
      }
      .email-bg-muted {
        background-color: ${colors?.light?.muted || defaultColors.light.muted} !important;
      }
      .email-border-border {
        border-color: ${colors?.light?.border || defaultColors.light.border} !important;
      }
      .email-text-card-foreground {
        color: ${colors?.light?.cardForeground || defaultColors.light.cardForeground} !important;
      }
      .email-text-foreground {
        color: ${colors?.light?.foreground || defaultColors.light.foreground} !important;
      }
      .email-text-muted-foreground {
        color: ${colors?.light?.mutedForeground || defaultColors.light.mutedForeground} !important;
      }
      .email-text-primary {
        color: ${colors?.light?.primary || defaultColors.light.primary} !important;
      }
      .email-text-primary-foreground {
        color: ${
        colors?.light?.primaryForeground || defaultColors.light.primaryForeground
      } !important;
      }
      .logo-dark {
        display: none !important;
      }
      .logo-light {
        display: block !important;
      }

      ${
        darkMode
          ? `@media (prefers-color-scheme: dark) {
        .email-bg-background {
          background-color: ${colors?.dark?.background || defaultColors.dark.background} !important;
        }
        .email-bg-card {
          background-color: ${colors?.dark?.card || defaultColors.dark.card} !important;
        }
        .email-bg-primary {
          background-color: ${colors?.dark?.primary || defaultColors.dark.primary} !important;
        }
        .email-bg-muted {
          background-color: ${colors?.dark?.muted || defaultColors.dark.muted} !important;
        }
        .email-border-border {
          border-color: ${colors?.dark?.border || defaultColors.dark.border} !important;
        }
        .email-text-card-foreground {
          color: ${colors?.dark?.cardForeground || defaultColors.dark.cardForeground} !important;
        }
        .email-text-foreground {
          color: ${colors?.dark?.foreground || defaultColors.dark.foreground} !important;
        }
        .email-text-muted-foreground {
          color: ${colors?.dark?.mutedForeground || defaultColors.dark.mutedForeground} !important;
        }
        .email-text-primary {
          color: ${colors?.dark?.primary || defaultColors.dark.primary} !important;
        }
        .email-text-primary-foreground {
          color: ${
            colors?.dark?.primaryForeground || defaultColors.dark.primaryForeground
          } !important;
        }
        .logo-dark {
          display: block !important;
        }
        .logo-light {
          display: none !important;
        }
        * {
          box-shadow: none !important;
        }
      }`
          : ""
      }
    `}
    </style>
  )
}
