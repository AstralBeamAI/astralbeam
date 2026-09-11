export const siteMetadata = {
  name: "AstralBeam",
  origin: "https://www.astralbeam.ai",
  title: "AstralBeam - The Agentic Chat Widget for Your App",
  description:
    "Open source agent infrastructure. Drop a Cursor-style agentic chat widget into your app. It streams answers, calls your tools, renders your components, and works with users' files. Self-host it or use AstralBeam Cloud.",
  email: "hello@astralbeam.ai",
  links: {
    app: "https://app.astralbeam.ai",
    signUp: "https://app.astralbeam.ai/auth/sign-up",
    logIn: "https://app.astralbeam.ai/auth/sign-in",
    docs: "https://app.astralbeam.ai/docs",
    github: "https://github.com/astralbeamai/astralbeam",
    discord: "https://discord.gg/suehFycUvW",
  },
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
