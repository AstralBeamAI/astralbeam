import { FileIcon } from "@/components/icons"
import { cssVars } from "@/lib/css-vars"

/* The scripted transcript ships in the HTML so the panel is not empty without JavaScript.
   main.ts detaches it on load and replays it one message at a time. */
export function AgentDemo() {
  return (
    <aside className="panel agent-panel" id="agent-demo">
      <header className="agent-bar mono">
        <span className="agent-title">ACME ASSISTANT</span>
        <button className="agent-replay mono" type="button" data-replay="">
          <svg className="icon-replay" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13.6 8a5.6 5.6 0 1 1-1.7-4"></path>
            <path d="M12.6 1.3v3.2H9.4"></path>
          </svg>
          REPLAY
        </button>
      </header>

      <div className="agent-thread" data-thread="">
        <article className="agent-msg is-user" data-step="">
          <p>Refund order 4821 and let the customer know.</p>
        </article>
        <article className="agent-msg is-agent" data-step="">
          <ul className="agent-tools mono">
            <li className="agent-tool" data-tool="">
              <i className="tool-dot" aria-hidden="true"></i>
              <span className="tool-name">lookupOrder</span>
              <b>4821</b>
            </li>
            <li className="agent-tool" data-tool="">
              <i className="tool-dot" aria-hidden="true"></i>
              <span className="tool-name">refundOrder</span>
              <b>$128.00</b>
            </li>
            <li className="agent-tool" data-tool="">
              <i className="tool-dot" aria-hidden="true"></i>
              <span className="tool-name">sendEmail</span>
              <b>receipt</b>
            </li>
          </ul>
          {/* The host's own <OrderCard /> widget, drawn inside the reply. */}
          <div className="agent-widget" data-widget="">
            <header className="widget-head mono">
              <span>ORDER 4821</span>
              <span className="widget-badge">REFUNDED</span>
            </header>
            <dl className="widget-rows mono">
              <div>
                <dt>Customer</dt>
                <dd>Dana Whitfield</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>$128.00</dd>
              </div>
              <div>
                <dt>Card</dt>
                <dd>Visa ···4242</dd>
              </div>
            </dl>
          </div>
          <p className="agent-stream" data-stream="">
            Refunded $128.00 and emailed Dana the confirmation.
          </p>
        </article>
        <article className="agent-msg is-user" data-step="">
          <a
            className="agent-attachment mono"
            href="/demo/returns-q3.csv"
            download
            title="Download the sample file"
          >
            <FileIcon />
            returns-q3.csv <b>41 rows</b>
          </a>
          <p>Which of these returns are still unpaid? Put them in a spreadsheet.</p>
        </article>
        <article className="agent-msg is-agent" data-step="">
          <ul className="agent-tools mono">
            <li className="agent-tool" data-tool="">
              <i className="tool-dot" aria-hidden="true"></i>
              <span className="tool-name">readAttachment</span>
              <b>returns-q3.csv</b>
            </li>
            <li className="agent-tool" data-tool="">
              <i className="tool-dot" aria-hidden="true"></i>
              <span className="tool-name">sandbox</span>
              <b>python unpaid.py</b>
            </li>
          </ul>
          {/* A sandbox artifact, published as a signed download. */}
          <a
            className="agent-widget agent-artifact mono"
            data-widget=""
            href="/demo/unpaid-returns.xlsx"
            download
            title="Download the sample spreadsheet"
          >
            <FileIcon />
            <span className="artifact-name">unpaid-returns.xlsx</span>
            <span className="artifact-size">17 KB</span>
            <span className="artifact-download" aria-hidden="true">
              ↓
            </span>
          </a>
          <p className="agent-stream" data-stream="">
            3 of 41 returns are still unpaid, $612 in total. The spreadsheet is ready to download.
          </p>
        </article>
        <article className="agent-msg is-user" data-step="">
          <p>How have refunds trended over the last six weeks?</p>
        </article>
        <article className="agent-msg is-agent" data-step="">
          <ul className="agent-tools mono">
            <li className="agent-tool" data-tool="">
              <i className="tool-dot" aria-hidden="true"></i>
              <span className="tool-name">refundsByWeek</span>
              <b>6 weeks</b>
            </li>
          </ul>
          {/* The host's own <RefundsChart /> widget: one series, peak week emphasized. */}
          <figure className="agent-widget agent-chart" data-widget="">
            <figcaption className="widget-head mono">
              <span>REFUNDS BY WEEK</span>
              <span className="chart-total">$8,200</span>
            </figcaption>
            <div
              className="chart-plot"
              role="img"
              aria-label="Refunds by week: week 33 $1,180, week 34 $2,140, week 35 $1,760, week 36 $1,320, week 37 $980, week 38 $820."
            >
              {chartColumns.map((column) => (
                <div
                  key={column.week}
                  className={column.peak ? "chart-col is-peak" : "chart-col"}
                  style={cssVars({ "--v": column.height })}
                >
                  {column.peak && <b className="chart-value mono">$2,140</b>}
                  <i className="chart-bar" aria-hidden="true"></i>
                </div>
              ))}
            </div>
            <ul className="chart-ticks mono">
              {chartColumns.map((column) => (
                <li key={column.week}>{column.week}</li>
              ))}
            </ul>
          </figure>
          <p className="agent-stream" data-stream="">
            Refunds peaked at $2,140 in week 34 after the carrier delay, then fell 62% by week 38.
          </p>
        </article>
      </div>

      <form className="agent-composer" data-composer="">
        <input
          className="agent-input"
          type="text"
          autoComplete="off"
          placeholder="Ask the agent…"
          aria-label="Ask the demo agent"
          data-input=""
        />
        <button className="agent-send" type="submit" aria-label="Send message">
          ↑
        </button>
      </form>
    </aside>
  )
}

const chartColumns = [
  { week: "W33", height: "55%" },
  { week: "W34", height: "100%", peak: true },
  { week: "W35", height: "82%" },
  { week: "W36", height: "62%" },
  { week: "W37", height: "46%" },
  { week: "W38", height: "38%" },
]
