// .hero drops to `min-height: 0` under 900px so the landing hero can stack inside its own
// .hero-copy. This page has no .hero-copy, so it keeps the full-height box.
const fullHeight = { minHeight: "100svh" }

export function SignalLost() {
  return (
    <>
      <div className="fx-scanlines" aria-hidden="true"></div>
      <div className="fx-vignette" aria-hidden="true"></div>
      <main className="hero" style={fullHeight}>
        <div className="hero-inner">
          <p className="eyebrow">&#47;&#47; ERROR 404</p>
          <h1
            className="display hero-title beam-text"
            style={{ fontSize: "clamp(3rem, 10vw, 7rem)" }}
          >
            SIGNAL LOST
          </h1>
          <p className="hero-sub">
            This sector is uncharted. The page you requested does not exist.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary btn-lg" href="/">RETURN TO BASE</a>
          </div>
        </div>
      </main>
    </>
  )
}
