// Resolved sRGB values for the AstralBeam brand theme (docs/brand.md, pre-Deno-migration
// apps/webapp/src/brand/theme.json), computed once via webapp/src/theme/theme.ts's color
// engine. www only needs static hex values for meta tags and generated images, so the
// resolution engine itself is not duplicated here.
export const palette = {
  dark: {
    background: { srgbHex: "#061014" },
    foreground: { srgbHex: "#edf8f6" },
    primary: { srgbHex: "#35d6b0" },
    border: { srgbHex: "#233237" },
    mutedForeground: { srgbHex: "#acb9b8" },
  },
  light: {
    background: { srgbHex: "#f7fcfb" },
    foreground: { srgbHex: "#07191d" },
    primary: { srgbHex: "#0c7a69" },
    border: { srgbHex: "#dee5e4" },
    mutedForeground: { srgbHex: "#637171" },
  },
} as const
