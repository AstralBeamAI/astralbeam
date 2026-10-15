import type { ReactNode } from "react"

import logo from "@/assets/astralbeam-logo-light.svg?url&no-inline"
import { siteMetadata } from "@/lib/site"

export function BlogShell({ children }: { children: ReactNode }) {
  return (
    <div className="blog-shell">
      <a className="blog-skip" href="#blog-main">
        Skip to content
      </a>
      <header className="blog-header">
        <a className="blog-brand" href="/" aria-label="AstralBeam home">
          <img src={logo} alt="" width="30" height="30" />
          <span>AstralBeam</span>
        </a>
        <nav aria-label="Primary">
          <a href="/blog" aria-current="page">
            Blog
          </a>
          <a href={siteMetadata.links.docs}>Docs</a>
          <a href={siteMetadata.links.signUp}>
            Get started <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main id="blog-main" className="blog-main">
        {children}
      </main>
      <footer className="blog-footer">
        <span>© 2026 AstralBeam</span>
        <nav aria-label="Footer">
          <a href="/blog/feed.xml">RSS</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </div>
  )
}
