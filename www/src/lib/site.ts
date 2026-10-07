// The platform serves this website under its own origin, so the app and website links share it.
const origin = "https://astralbeam.ai"

export const siteMetadata = {
  name: "AstralBeam",
  origin,
  title: "AstralBeam - Add an Agent to Your App in Minutes",
  description:
    "Embed a Cursor-style agent in your product. It answers queries, interacts with your app, renders your UI components, and works with users' files.",
  email: "hello@astralbeam.ai",
  links: {
    signUp: `${origin}/auth/sign-up`,
    logIn: `${origin}/auth/sign-in`,
    docs: `${origin}/docs`,
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
    alt: "AstralBeam: add an agent to your app in minutes.",
  },
} as const

export function siteUrl(pathname: string) {
  return new URL(pathname, siteMetadata.origin).href
}
