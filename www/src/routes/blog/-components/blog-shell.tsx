import type { ReactNode } from "react"

import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"

export function BlogShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="blog-skip" href="#blog-main">
        Skip to content
      </a>
      <SiteHeader />
      <div className="blog-shell">
        <main id="blog-main" className="blog-main">
          {children}
        </main>
      </div>
      <SiteFooter />
    </>
  )
}
