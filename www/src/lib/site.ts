export const siteMetadata = {
  name: "AstralBeam",
  origin: "https://www.astralbeam.ai",
  title: "AstralBeam - Ship agents in minutes, not months",
  description:
    "Open source AI agent infrastructure. Drop in the frontend SDK, and AstralBeam handles agentic chat, streaming, history, tools, metering, billing, and auth.",
  email: "hello@astralbeam.ai",
  icon: {
    path: "/favicon.png",
    size: 512,
  },
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
