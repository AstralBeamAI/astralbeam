// Static sRGB values from platform/scripts/theme/brand.json, resolved by its theme compiler.
// See ../../../docs/brand.md for the shared brand.
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
