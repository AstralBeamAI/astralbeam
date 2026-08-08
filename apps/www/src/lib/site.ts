export const sitePalette = {
  background: "#04080a",
  panel: "#0a1216",
  foreground: "#e9f4f1",
  muted: "#8ba5a1",
  accent: "#37f2c9",
  border: "#314449",
} as const

export const siteMetadata = {
  name: "AstralBeam",
  origin: "https://www.astralbeam.ai",
  title: "AstralBeam - Ship agents in minutes, not months",
  description:
    "Open-source agent infrastructure. One service to add production-ready agents to any app: streaming, history, tools, billing, auth, and evals.",
  email: "hello@astralbeam.ai",
  themeColor: sitePalette.background,
  socialImage: {
    path: "/og-image.png",
    width: 1200,
    height: 630,
    alt: "AstralBeam mission console: Ship agents in minutes, not months.",
  },
} as const

export function siteUrl(pathname: string, base: string | URL = siteMetadata.origin) {
  return new URL(pathname, base).href
}
