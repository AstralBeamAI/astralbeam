import { useEffect, useRef, useState } from "react"

import astralbeamDarkLogoUrl from "@/assets/astralbeam-logo-dark.svg?url&no-inline"
import astralbeamDarkWordmarkUrl from "@/assets/astralbeam-wordmark-dark.svg?url&no-inline"
import { DiscordIcon, GithubIcon, XIcon } from "@/components/icons"
import { siteMetadata } from "@/lib/site"

const {
  signUp: signUpUrl,
  logIn: logInUrl,
  docs: docsUrl,
  discord: discordUrl,
  github: githubUrl,
  x: xUrl,
} = siteMetadata.links

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close()
        toggleRef.current?.focus()
      }
    }
    document.addEventListener("click", close)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("click", close)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <header className="hud-top">
      <div className="hud-inner">
        <a className="hud-brand" href="/" aria-label="AstralBeam home">
          <img
            className="hud-brand-wordmark"
            src={astralbeamDarkWordmarkUrl}
            alt=""
            width="1241"
            height="136"
          />
          <img
            className="hud-brand-mark"
            src={astralbeamDarkLogoUrl}
            alt=""
            width="270"
            height="270"
          />
        </a>
        <nav
          className="hud-nav"
          id="hud-nav"
          aria-label="Primary"
          data-open={open ? "" : undefined}
        >
          <span className="hud-nav-socials">
            <a
              className="hud-nav-social"
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="AstralBeam on GitHub"
              title="GitHub"
            >
              <GithubIcon />
            </a>
            <a
              className="hud-nav-social"
              href={discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="AstralBeam on Discord"
              title="Discord"
            >
              <DiscordIcon />
            </a>
            <a
              className="hud-nav-social"
              href={xUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="AstralBeam on X (Twitter)"
              title="X (Twitter)"
            >
              <XIcon />
            </a>
          </span>
          <a href={docsUrl}>DOCS</a>
          <a href="/blog">BLOG</a>
          <a href="/home#pricing">PRICING</a>
          <a href={logInUrl} data-session="signed-out">
            SIGN IN
          </a>
        </nav>
        <a className="btn btn-primary hud-cta" href="/" data-session="signed-in">
          DASHBOARD
        </a>
        <a className="btn btn-primary hud-cta" href={signUpUrl} data-session="signed-out">
          GET STARTED
        </a>
        <button
          className="hud-menu"
          type="button"
          aria-controls="hud-nav"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          ref={toggleRef}
          onClick={(event) => {
            event.stopPropagation()
            setOpen(!open)
          }}
        >
          <svg className="icon-menu" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 4h12"></path>
            <path d="M2 8h12"></path>
            <path d="M2 12h12"></path>
          </svg>
        </button>
      </div>
    </header>
  )
}
