import { siteMetadata } from "@/lib/site"

const { docs: docsUrl, discord: discordUrl, github: githubUrl, x: xUrl } = siteMetadata.links

export function SiteFooter() {
  return (
    <footer className="site-footer mono">
      <span>© 2026 ASTRALBEAM</span>
      <a href="/home#pricing">PRICING</a>
      <a href={docsUrl}>DOCS</a>
      <a href="/blog">BLOG</a>
      <a href={githubUrl} target="_blank" rel="noopener noreferrer">
        GITHUB
      </a>
      <a href={discordUrl} target="_blank" rel="noopener noreferrer">
        DISCORD
      </a>
      <a href={xUrl} target="_blank" rel="noopener noreferrer">
        X
      </a>
      <a href="mailto:hello@astralbeam.ai">
        <span className="mail-full">HELLO@ASTRALBEAM.AI</span>
        <span className="mail-short">CONTACT</span>
      </a>
      <a href="/terms">TERMS</a>
      <a href="/privacy">PRIVACY</a>
      <a href="/licenses.txt">LICENSES</a>
    </footer>
  )
}
