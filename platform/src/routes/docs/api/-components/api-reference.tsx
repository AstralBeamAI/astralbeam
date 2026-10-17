import { ApiReferenceReact, type ReferenceProps } from "@scalar/api-reference-react"
import "@scalar/api-reference-react/style.css"
import { getRouteApi } from "@tanstack/react-router"
import { useEffect } from "react"
import { useTheme } from "tanstack-router-theme-provider"
import { APP_LOGO_LIGHT_SVG_URL } from "@/lib/constants"
import scalarStyles from "../../-lib/scalar.css?inline"

const apiDocsRoute = getRouteApi("/docs/api/")

// https://scalar.com/products/api-references/configuration
const apiDocsScalarOptions = {
  withDefaultFonts: false,
  hideClientButton: true,
  hideDarkModeToggle: true,
  showDeveloperTools: "never",
  documentDownloadType: "none",
  agent: { disabled: true },
  mcp: { disabled: true },
  authentication: {
    preferredSecurityScheme: "OrganizationApiKey",
    securitySchemes: {
      OrganizationApiKey: {
        value:
          "key_01990a5d-0000-7000-8000-000000000011_01990a5d-0000-7000-8000-000000000021_abo_kQmVrTsXpLnBwYcDfGhJzAeRuIoPsNdFkLwCxVbMnQeRtYuHiOpAsDfGhJkLzXcV",
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
  customCss: scalarStyles,
  generateTagSlug: ({ name }) => name!,
} satisfies NonNullable<ReferenceProps["configuration"]>

export function ApiDocsReference() {
  const content = apiDocsRoute.useLoaderData()
  const { resolvedTheme } = useTheme()
  useEffect(() => () => document.body.classList.remove("light-mode", "dark-mode"), [])
  if (!resolvedTheme) return null

  return (
    <div className={resolvedTheme === "dark" ? "dark-mode" : "light-mode"}>
      <ApiReferenceReact
        configuration={{
          ...apiDocsScalarOptions,
          content,
          baseServerURL: window.location.origin,
          darkMode: resolvedTheme === "dark",
        }}
      />
    </div>
  )
}
