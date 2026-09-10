export const siteMetadata = {
  name: "AstralBeam",
  origin: "https://www.astralbeam.ai",
  title: "AstralBeam - The agentic chat widget for your app",
  description:
    "Open source agent infrastructure. Drop a Cursor-style agentic chat widget into your app. It streams answers, calls your tools, renders your components, and works with users' files. Self-host it or use AstralBeam Cloud.",
  email: "hello@astralbeam.ai",
  icon: {
    path: "/favicon.png",
    size: 512,
  },
  socialImage: {
    path: "/og-image.png",
    width: 1200,
    height: 630,
    alt: "AstralBeam: the agentic chat widget for your app.",
  },
} as const

export function siteUrl(pathname: string, base: string | URL = siteMetadata.origin) {
  return new URL(pathname, base).href
}
