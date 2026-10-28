// The platform serves this website under its own origin, so the app and website links share it.
const origin = "https://astralbeam.ai"

// Update when the landing page's product or pricing information changes.
export const landingUpdated = "2026-10-28"

export const siteMetadata = {
  name: "AstralBeam",
  origin,
  title: "AstralBeam - Add an Agent to Your App in Minutes",
  description:
    "Embed a Cursor-style agentic chat sidebar in your app. It answers questions, takes actions, displays your UI widgets, and works with users' files.",
  email: "hello@astralbeam.ai",
  links: {
    signUp: "/auth/sign-up",
    logIn: "/auth/sign-in",
    docs: "/docs",
    github: "https://github.com/astralbeamai/astralbeam",
    discord: "https://discord.gg/suehFycUvW",
    x: "https://x.com/AstralBeamAI",
  },
  icon: {
    path: "/favicon.png",
    size: 512,
  },
  socialImage: {
    path: "/og-image.png",
    width: 1200,
    height: 630,
    alt: "AstralBeam: add an agent to your app in minutes.",
  },
} as const

export function siteUrl(pathname: string) {
  return new URL(pathname, siteMetadata.origin).href
}
