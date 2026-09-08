import { HttpRouter } from "effect/unstable/http"
import { HttpApiScalar, OpenApi } from "effect/unstable/httpapi"
import { TenantRestApi } from "../../api/v1/-lib/contract.server"
import gettingStarted from "../-content/api/getting-started.md?raw"
import authentication from "../-content/api/authentication.md?raw"
import pagination from "../-content/api/pagination-and-errors.md?raw"
import appStyles from "../../../styles.css?raw"
import scalarStyles from "./scalar.css?inline"
import docsHeaderStyles from "./header.css?inline"
import { APP_LOGO_LIGHT_SVG_URL } from "../../../lib/constants"

// Reuse the compiler's output without importing Tailwind resets or running the compiler at runtime.
const apiDocsTheme = appStyles.split("/* Generated theme variables: start */")[1]!
  .split("/* Generated theme variables: end */")[0]!.replaceAll(".dark", ".dark-mode")

export const apiDocsStyles = `${apiDocsTheme}\n${scalarStyles}\n${docsHeaderStyles}`

// Scalar accepts these options although Effect exposes only a subset of its configuration type.
// https://scalar.com/products/api-references/configuration
const apiDocsScalarOptions = {
  withDefaultFonts: false,
  hideClientButton: true,
  showDeveloperTools: "never",
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
}

export const apiDocsHandler = HttpRouter.toWebHandler(
  HttpApiScalar.layer(
    TenantRestApi.annotate(
      OpenApi.Description,
      [gettingStarted, authentication, pagination].join("\n\n"),
    ),
    { path: "/docs/api", scalar: apiDocsScalarOptions },
  ),
  { disableLogger: true },
)
