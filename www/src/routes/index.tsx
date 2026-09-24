import { createFileRoute } from "@tanstack/react-router"
import { type MouseEvent, useEffect } from "react"

import astralbeamDarkLogoUrl from "@/assets/astralbeam-logo-dark.svg?url&no-inline"
import astralbeamDarkWordmarkUrl from "@/assets/astralbeam-wordmark-dark.svg?url&no-inline"
import { CheckIcon, CopyIcon, DiscordIcon, GithubIcon } from "@/components/icons"
import { cssVars } from "@/lib/css-vars"
import { pageHead } from "@/lib/page-head"
import { siteMetadata } from "@/lib/site"
import { startSiteEffects } from "@/scripts/main"

import { AgentDemo } from "./-landing/agent-demo"
import { highlight, integrations, steps } from "./-landing/content"

const {
  signUp: signUpUrl,
  logIn: logInUrl,
  docs: docsUrl,
  discord: discordUrl,
  github: githubUrl,
} = siteMetadata.links

const agentPrompt = `Add an AstralBeam agent sidebar to this app by following ${docsUrl}/start/quickstart. Install @astralbeam/sdk, add a server endpoint that mints a chat token with createAstralBeamToken for the signed-in user and their tenant, and mount <AstralBeamChat /> where the sidebar belongs. Read ASTRALBEAM_API_KEY from the server environment and never expose it to browser code.`

// Toggles the label with a data attribute because nothing on this page re-renders.
function copyPrompt(event: MouseEvent<HTMLButtonElement>) {
  const button = event.currentTarget
  void navigator.clipboard.writeText(agentPrompt).then(() => {
    button.dataset.copied = ""
    setTimeout(() => delete button.dataset.copied, 2000)
  })
}

export const Route = createFileRoute("/")({
  head: () =>
    pageHead({
      title: siteMetadata.title,
      description: siteMetadata.description,
      canonicalPath: "/",
    }),
  component: LandingPage,
})

function LandingPage() {
  // The starfield, scramble-in headlines, scroll reveals, terminal typing, and the agent-sidebar
  // replay are imperative and own their DOM outright. Nothing on this page re-renders.
  useEffect(startSiteEffects, [])

  return (
    <>
      {/* fixed deep-space starfield */}
      <canvas id="starfield" aria-hidden="true"></canvas>

      {/* CRT / scanline / vignette overlays */}
      <div className="fx-scanlines" aria-hidden="true"></div>
      <div className="fx-vignette" aria-hidden="true"></div>

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
          <nav className="hud-nav" id="hud-nav" aria-label="Primary">
            <a
              className="hud-nav-social"
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="AstralBeam on GitHub"
            >
              <GithubIcon />
              <span className="hud-nav-label">GITHUB</span>
            </a>
            <a
              className="hud-nav-social"
              href={discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="AstralBeam on Discord"
            >
              <DiscordIcon />
              <span className="hud-nav-label">DISCORD</span>
            </a>
            <a href={docsUrl}>DOCS</a>
            <a href={logInUrl}>SIGN IN</a>
          </nav>
          <a className="btn btn-primary hud-cta" href={signUpUrl}>
            GET STARTED
          </a>
          <button
            className="hud-menu"
            type="button"
            aria-controls="hud-nav"
            aria-expanded="false"
            aria-label="Open menu"
            data-menu=""
          >
            <svg className="icon-menu" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 4h12"></path>
              <path d="M2 8h12"></path>
              <path d="M2 12h12"></path>
            </svg>
          </button>
        </div>
      </header>

      <main>
        {/* ============ HERO ============ */}
        <section className="hero" id="top">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="eyebrow reveal">
                OPEN SOURCE · <span>SELF-HOSTED</span> OR MANAGED
              </p>
              <h1 className="display hero-title">
                <span className="reveal scramble" data-text="ADD AN AGENT">
                  ADD AN AGENT
                </span>
                <br />
                <span
                  className="reveal scramble beam-text"
                  data-text="TO YOUR APP"
                  style={cssVars({ "--reveal-delay": ".12s" })}
                >
                  TO YOUR APP
                </span>
                <br />
                <span
                  className="reveal scramble"
                  data-text="IN MINUTES"
                  style={cssVars({ "--reveal-delay": ".24s" })}
                >
                  IN MINUTES
                </span>
              </h1>
              <p className="hero-sub reveal" style={cssVars({ "--reveal-delay": ".36s" })}>
                {siteMetadata.description}
              </p>
              <div className="hero-ctas reveal" style={cssVars({ "--reveal-delay": ".48s" })}>
                <a className="btn btn-primary btn-lg" href={signUpUrl}>
                  GET STARTED
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-lg copy-prompt"
                  onClick={copyPrompt}
                >
                  <span>
                    <CopyIcon />
                    COPY PROMPT
                  </span>
                  <span>
                    <CheckIcon />
                    COPIED
                  </span>
                </button>
              </div>
            </div>

            <div className="hero-demo reveal" style={cssVars({ "--reveal-delay": ".3s" })}>
              <AgentDemo />
            </div>
          </div>

          <a className="scroll-cue" href="#step-01" aria-label="Skip to the next section">
            <i className="scroll-chevron" aria-hidden="true"></i>
          </a>
        </section>

        {/* ============ STEPS ============ */}
        {steps.map((step) => (
          <section className="section step" id={`step-${step.index}`} key={step.index}>
            <div className="section-head">
              <p className="step-index mono reveal">STEP {step.index}</p>
              <h2 className="display section-title reveal scramble" data-text={step.title}>
                {step.title}
              </h2>
              <p className="section-sub reveal">{step.desc}</p>
            </div>
            <div className="step-body">
              <div className="panel terminal reveal" data-terminal="">
                <header className="terminal-bar mono">
                  <span className="term-dots">
                    <i></i>
                    <i></i>
                    <i></i>
                  </span>
                  <span>{step.file}</span>
                </header>
                <pre className="terminal-body mono" aria-label={`Step ${step.index} code`}>
                  <code>{highlight(step.code)}</code>
                  <span className="t-caret" aria-hidden="true"></span>
                </pre>
              </div>
              <ul className="benefits">
                {step.benefits.map((benefit, i) => (
                  <li
                    className="panel benefit reveal"
                    key={benefit.name}
                    style={cssVars({ "--reveal-delay": `${(i % 2) * 0.1 + 0.1}s` })}
                  >
                    <h3 className="benefit-name">{benefit.name}</h3>
                    <p className="benefit-desc">{benefit.desc}</p>
                    {benefit.soon && (
                      <p className="benefit-status">
                        <span className="tag mono">IN PROGRESS</span>
                      </p>
                    )}
                    <i className="panel-corner" aria-hidden="true"></i>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}

        {/* ============ INTEGRATIONS ============ */}
        <section className="section" id="integrations">
          <div className="section-head">
            <h2 className="display section-title reveal scramble" data-text="WORKS WITH YOUR STACK">
              WORKS WITH YOUR STACK
            </h2>
            <p className="section-sub reveal">
              AstralBeam sits between your app and the providers you already pay for. Swap any of
              them without touching the widget.
            </p>
          </div>

          <div className="integrations-grid">
            {integrations.map((group, i) => (
              <div
                className="panel integration-panel reveal"
                key={group.label}
                style={cssVars({ "--reveal-delay": `${(i % 2) * 0.1}s` })}
              >
                <h3 className="integration-label mono">{group.label}</h3>
                <p className="integration-desc">{group.desc}</p>
                <ul className="chips mono">
                  {group.items.map((item) => (
                    <li
                      className={item.soon ? "chip is-soon" : "chip"}
                      key={item.name}
                      title={item.soon ? "In progress" : undefined}
                    >
                      {item.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ============ OPEN SOURCE ============ */}
        <section className="section" id="open-source">
          <svg className="os-watermark" viewBox="-84 -62 168 124" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M -6.56 -18.02 A 30 34 0 1 0 -6.56 18.02"></path>
              <ellipse cx="32" cy="0" rx="30" ry="34"></ellipse>
              <path
                transform="rotate(22)"
                d="M 0 -56 C 4 -50 6.5 -42 6.5 -31 L 6.5 31 C 6.5 42 4 50 0 56 C -4 50 -6.5 42 -6.5 31 L -6.5 -31 C -6.5 -42 -4 -50 0 -56 Z"
              ></path>
            </g>
          </svg>

          <div className="section-head">
            <h2
              className="display section-title reveal scramble"
              data-text="OPEN SOURCE FROM DAY ONE"
            >
              OPEN SOURCE FROM DAY ONE
            </h2>
            <p className="section-sub reveal">
              The AstralBeam platform is open source under AGPL-3.0, built on open standards, and
              modular by design. Read it, fork it, run it, extend it.
            </p>
          </div>

          <div className="os-grid">
            <div className="panel os-panel reveal">
              <h3 className="os-name mono">SELF-HOST</h3>
              <p>
                Run the whole platform on your own infrastructure. Your data never leaves your
                orbit.
              </p>
            </div>
            <div className="panel os-panel reveal" style={cssVars({ "--reveal-delay": ".1s" })}>
              <h3 className="os-name mono">CLOUD</h3>
              <p>
                Let us run it for you: managed infrastructure, zero maintenance, always current.
              </p>
            </div>
            <div className="panel os-panel reveal" style={cssVars({ "--reveal-delay": ".2s" })}>
              <h3 className="os-name mono">MODULAR</h3>
              <p>Start with the entire platform, or adopt it incrementally, piece by piece.</p>
            </div>
            <div className="panel os-panel reveal" style={cssVars({ "--reveal-delay": ".3s" })}>
              <h3 className="os-name mono">OPEN PROTOCOLS</h3>
              <p>
                Built on open protocols: AG-UI, MCP, A2A. Swap pieces in and out instead of adopting
                a proprietary runtime.
              </p>
            </div>
          </div>

          <div className="os-repo reveal" style={cssVars({ "--reveal-delay": ".35s" })}>
            <a
              className="btn btn-ghost btn-lg"
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GithubIcon />
              BROWSE THE SOURCE
            </a>
            <a className="btn btn-ghost btn-lg" href={`${docsUrl}/self-hosting`}>
              SELF-HOSTING GUIDE
            </a>
          </div>
        </section>

        {/* ============ LAUNCH ============ */}
        <section className="section launch" id="launch">
          <h2 className="display launch-title reveal scramble" data-text="READY FOR LAUNCH">
            READY FOR LAUNCH
          </h2>
          <p className="section-sub launch-sub reveal">
            Get started with a few lines of code, <span>or come talk to us on Discord.</span>
          </p>
          <div className="launch-ctas reveal" style={cssVars({ "--reveal-delay": ".2s" })}>
            <a className="btn btn-primary btn-xl" href={signUpUrl}>
              GET STARTED
            </a>
            <a
              className="btn btn-ghost btn-xl"
              href={discordUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <DiscordIcon />
              JOIN DISCORD
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer mono">
        <span>© 2026 ASTRALBEAM</span>
        <a href={docsUrl}>DOCS</a>
        <a href={githubUrl} target="_blank" rel="noopener noreferrer">
          GITHUB
        </a>
        <a href={discordUrl} target="_blank" rel="noopener noreferrer">
          DISCORD
        </a>
        <a href="mailto:hello@astralbeam.ai">
          <span className="mail-full">HELLO@ASTRALBEAM.AI</span>
          <span className="mail-short">CONTACT</span>
        </a>
        <a href="/terms">TERMS</a>
        <a href="/privacy">PRIVACY</a>
        <a href="/licenses.txt">LICENSES</a>
      </footer>
    </>
  )
}
