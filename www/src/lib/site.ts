export const siteMetadata = {
  name: "AstralBeam",
  origin: "https://www.astralbeam.ai",
  title: "AstralBeam - Open-source AI agents for your app",
  description:
    "Add a Cursor-style AI agent to your React or JavaScript app. Connect your tools, render your UI components, and work with users' files. Self-host or use AstralBeam Cloud.",
  email: "hello@astralbeam.ai",
  links: {
    app: "https://app.astralbeam.ai",
    signUp: "https://app.astralbeam.ai/auth/sign-up",
    logIn: "https://app.astralbeam.ai/auth/sign-in",
    docs: "https://app.astralbeam.ai/docs",
    quickstart: "https://app.astralbeam.ai/docs/start/quickstart",
    selfHosting: "https://app.astralbeam.ai/docs/self-hosting/overview",
    example: "https://app.astralbeam.ai/docs/start/todos-tutorial",
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
