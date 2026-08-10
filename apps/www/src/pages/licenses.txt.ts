import type { APIRoute } from "astro"

import oflLicense from "../../../../docs/legal/LICENSES/OFL-1.1.txt?raw"
import mitLicense from "../../../../LICENSE-MIT?raw"

const licenseText = [
  "AstralBeam website licenses and notices",
  "",
  mitLicense.trimEnd(),
  "",
  oflLicense.trimEnd(),
  "",
].join("\n")

export const prerender = true

export const GET: APIRoute = () =>
  new Response(licenseText, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  })
