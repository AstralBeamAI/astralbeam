export const siteMetadata = {
  name: "AstralBeam",
  origin: "https://www.astralbeam.ai",
  title: "AstralBeam - Ship agents in minutes, not months",
  description:
    "Open source AI infrastructure. Add agentic chat to your web app in five minutes or less. AstralBeam handles streaming, history, tools, billing and more.",
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
