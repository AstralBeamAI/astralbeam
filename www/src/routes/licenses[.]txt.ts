import { createFileRoute } from "@tanstack/react-router"

import oflLicense from "../../../docs/legal/LICENSES/OFL-1.1.txt?raw"
import mitLicense from "../../../LICENSE-MIT?raw"

const licenseText = [
  "AstralBeam website licenses and notices",
  "",
  mitLicense.trimEnd(),
  "",
  oflLicense.trimEnd(),
  "",
].join("\n")

export const Route = createFileRoute("/licenses.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(licenseText, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": import.meta.env.DEV ? "no-cache" : "public, max-age=300",
          },
        }),
    },
  },
})
