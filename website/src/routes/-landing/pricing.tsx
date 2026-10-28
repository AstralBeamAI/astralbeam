import { siteMetadata } from "@/lib/site"

function UsageRates() {
  return (
    <>
      <div>
        <dt>Platform fee</dt>
        <dd>
          <strong>$0.20</strong> / million tokens
          <span>Same rate for input and output.</span>
        </dd>
      </div>
      <div>
        <dt>Conversation &amp; file storage</dt>
        <dd>
          <strong>$0.50</strong> / GB / month
        </dd>
      </div>
    </>
  )
}

export function Pricing() {
  return (
    <section className="section pricing" id="pricing" aria-labelledby="pricing-title">
      <div className="section-head">
        <p className="eyebrow">PRICING</p>
        <h2 className="display section-title" id="pricing-title">
          PAY FOR WHAT YOU USE
        </h2>
        <p className="section-sub">
          Start on our cloud, let us manage yours, or host it yourself. Bring your own LLM keys
          wherever you run.
        </p>
      </div>

      <div className="pricing-grid">
        <article className="panel pricing-card pricing-cloud">
          <p className="pricing-label mono">HOSTED BY ASTRALBEAM</p>
          <h3>Cloud</h3>
          <p className="pricing-desc">We run the platform. You build your product.</p>
          <dl className="pricing-rates">
            <UsageRates />
          </dl>
          <p className="pricing-credit mono">$20 in free credits every month</p>
          <a className="btn btn-primary btn-lg" href={siteMetadata.links.signUp}>
            Get Started
          </a>
        </article>

        <article className="panel pricing-card">
          <p className="pricing-label mono">YOUR INFRASTRUCTURE, OUR TEAM</p>
          <h3>Managed hosting</h3>
          <p className="pricing-desc">AstralBeam on your infrastructure, managed by us.</p>
          <dl className="pricing-rates">
            <UsageRates />
            <div>
              <dt>Hosting fee</dt>
              <dd>
                <strong>Custom</strong>
              </dd>
            </div>
          </dl>
          <a className="btn btn-ghost btn-lg" href={`mailto:${siteMetadata.email}`}>
            Talk to Us
          </a>
        </article>

        <article className="panel pricing-card">
          <p className="pricing-label mono">YOUR INFRASTRUCTURE, YOUR TEAM</p>
          <h3>Self-hosting</h3>
          <p className="pricing-desc">Run AstralBeam on your own infrastructure.</p>
          <p className="pricing-summary">Free</p>
          <p className="pricing-detail">
            No AstralBeam platform or storage fees. You cover your own infrastructure and providers.
          </p>
          <a className="btn btn-ghost btn-lg" href={`${siteMetadata.links.docs}/self-hosting`}>
            Self-hosting Guide
          </a>
        </article>
      </div>

      <p className="pricing-providers">
        Bring your own LLM keys. Models, sandboxes, and observability are billed directly by
        providers. Cloud credits cover AstralBeam fees only. All prices in USD.
      </p>
    </section>
  )
}
