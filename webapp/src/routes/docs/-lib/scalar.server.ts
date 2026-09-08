import type { ReferenceProps } from "@scalar/api-reference"
// Scalar publishes its self-contained browser entry without a package subpath export.
import scalarScript from "../../../../node_modules/@scalar/api-reference/dist/browser/standalone.js?raw"
import appStyles from "../../../styles.css?raw"
import scalarStyles from "./scalar.css?inline"
import docsHeaderStyles from "./header.css?inline"
import { APP_LOGO_LIGHT_SVG_URL, APP_NAME } from "../../../lib/constants"

// Reuse the compiler's output without importing Tailwind resets or running the compiler at runtime.
const apiDocsTheme = appStyles.split("/* Generated theme variables: start */")[1]!
  .split("/* Generated theme variables: end */")[0]!.replaceAll(".dark", ".dark-mode")

const apiDocsStyles = `${apiDocsTheme}\n${scalarStyles}\n${docsHeaderStyles}`

// https://scalar.com/products/api-references/configuration
const apiDocsScalarOptions = {
  withDefaultFonts: false,
  hideClientButton: true,
  showDeveloperTools: "never",
  documentDownloadType: "none",
  agent: { disabled: true },
  mcp: { disabled: true },
  authentication: {
    preferredSecurityScheme: "OrganizationApiKey",
    securitySchemes: {
      OrganizationApiKey: {
        value:
          "key_northstar_docs_abo_kQmVrTsXpLnBwYcDfGhJzAeRuIoPsNdFkLwCxVbMnQeRtYuHiOpAsDfGhJkLzXcV",
      },
    },
  },
  hiddenClients: {
    c: true,
    clojure: true,
    csharp: true,
    dart: true,
    fsharp: true,
    go: true,
    http: true,
    java: true,
    js: true,
    julia: true,
    kotlin: true,
    node: true,
    objc: true,
    ocaml: true,
    php: true,
    powershell: true,
    python: true,
    r: true,
    ruby: true,
    rust: true,
    shell: ["httpie", "wget"],
    swift: true,
  },
  favicon: APP_LOGO_LIGHT_SVG_URL,
  customCss: apiDocsStyles,
} satisfies NonNullable<ReferenceProps["configuration"]>

export function apiDocsHtml() {
  return `<!doctype html><html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${APP_NAME} API</title>
    <style>${apiDocsStyles}</style>
    </head><body>
    <div id="api-reference-container"></div>
    <script>${String(scalarScript).replaceAll("</script", "<\\/script")}</script>
    <script type="module">
    const response = await fetch('/api/openapi.json')
    const content = await response.json()
    // Group errors for presentation only; downloads keep the canonical explicit status codes.
    for (const methods of Object.values(content.paths)) {
      for (const operation of Object.values(methods)) {
        const responses = operation.responses
        if (!responses?.['400']) continue
        responses.default = {
          ...responses['400'],
          description: 'Error response. See [Errors](#description/errors) for status codes and handling.',
        }
        for (const status of Object.keys(responses)) {
          if (Number(status) >= 400) delete responses[status]
        }
      }
    }
    Scalar.createApiReference('#api-reference-container', { ...${
    JSON.stringify(apiDocsScalarOptions).replaceAll("<", "\\u003c")
  }, content, baseServerURL: window.location.origin, generateTagSlug: ({ name }) => name })</script>
    </body></html>`
}
