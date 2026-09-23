import type { ReactNode } from "react"

import astralbeamDarkLogoUrl from "@/assets/astralbeam-logo-dark.svg?url&no-inline"
import astralbeamDarkWordmarkUrl from "@/assets/astralbeam-wordmark-dark.svg?url&no-inline"
import { siteMetadata } from "@/lib/site"

interface LegalPageProps {
  title: string
  effectiveDate: string
  children: ReactNode
}

export function LegalPage({ title, effectiveDate, children }: LegalPageProps) {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <a className="legal-brand" href="/" aria-label="AstralBeam home">
          <img
            className="legal-brand-wordmark"
            src={astralbeamDarkWordmarkUrl}
            alt="AstralBeam"
            width="1241"
            height="136"
          />
          <img
            className="legal-brand-mark"
            src={astralbeamDarkLogoUrl}
            alt="AstralBeam"
            width="270"
            height="270"
          />
        </a>
        <nav aria-label="Legal documents">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </header>

      <main className="legal-main">
        <header className="legal-title">
          <p className="mono">&#47;&#47; LEGAL</p>
          <h1>{title}</h1>
          <p>Effective {effectiveDate}</p>
        </header>

        <article className="legal-content">{children}</article>
      </main>

      <footer className="legal-footer mono">
        <span>© 2026 ASTRALBEAM</span>
        <a href={`mailto:${siteMetadata.email}`}>{siteMetadata.email}</a>
        <a href="/">HOME</a>
      </footer>
    </div>
  )
}
