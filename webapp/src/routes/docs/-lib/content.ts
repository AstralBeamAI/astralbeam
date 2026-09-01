// Docs are authored as plain Markdown under -content/<section>/ and registered here; the
// section and page order in this manifest is the order the navigation shows.
import sdkAttachments from "../-content/sdk/attachments.md?raw"
import sdkAuthentication from "../-content/sdk/authentication.md?raw"
import sdkConfiguration from "../-content/sdk/configuration.md?raw"
import sdkGettingStarted from "../-content/sdk/getting-started.md?raw"
import sdkHeadless from "../-content/sdk/headless.md?raw"
import sdkSandbox from "../-content/sdk/sandbox.md?raw"
import sdkSecurity from "../-content/sdk/security.md?raw"
import sdkTheming from "../-content/sdk/theming.md?raw"
import sdkToolsAndWidgets from "../-content/sdk/tools-and-widgets.md?raw"

export interface DocsPage {
  slug: string
  title: string
  markdown: string
}

export interface DocsSection {
  slug: string
  title: string
  description: string
  pages: DocsPage[]
}

export const DOCS_SECTIONS: DocsSection[] = [
  {
    slug: "sdk",
    title: "SDK",
    description: "Embed the agent chat sidebar in your application.",
    pages: [
      { slug: "getting-started", title: "Getting started", markdown: sdkGettingStarted },
      { slug: "authentication", title: "Authentication", markdown: sdkAuthentication },
      { slug: "configuration", title: "Configuration", markdown: sdkConfiguration },
      { slug: "theming", title: "Theming", markdown: sdkTheming },
      { slug: "tools-and-widgets", title: "Tools and widgets", markdown: sdkToolsAndWidgets },
      { slug: "attachments", title: "Attachments", markdown: sdkAttachments },
      { slug: "sandbox", title: "Sandbox", markdown: sdkSandbox },
      { slug: "headless", title: "Headless", markdown: sdkHeadless },
      { slug: "security", title: "Security model", markdown: sdkSecurity },
    ],
  },
]

export function findDocsSection(sectionSlug: string): DocsSection | undefined {
  return DOCS_SECTIONS.find((section) => section.slug === sectionSlug)
}

export function findDocsPage(section: DocsSection, pageSlug: string): DocsPage | undefined {
  return section.pages.find((page) => page.slug === pageSlug)
}
