export const siteMetadata = {
  name: "AstralBeam",
  origin: "https://www.astralbeam.ai",
  title: "AstralBeam - Add an Agent to Your App in Minutes",
  description:
    "Drop a Cursor-style agent into your product. It answers queries, interacts with your app, renders your UI components, and works with users' files.",
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
    alt: "AstralBeam: add an agent to your app in minutes.",
  },
} as const

export function siteUrl(pathname: string) {
  return new URL(pathname, siteMetadata.origin).href
}
