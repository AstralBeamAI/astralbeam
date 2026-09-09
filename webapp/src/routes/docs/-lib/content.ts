// Docs are authored as plain Markdown under -content/<section>/ and registered here; the
// section and page order in this manifest is the order the navigation shows.
import sdkAttachments from "../-content/sdk/attachments.md?raw"
import sdkApi from "../-content/sdk/api.md?raw"
import sdkAuthentication from "../-content/sdk/authentication.md?raw"
import sdkConfiguration from "../-content/sdk/configuration.md?raw"
import sdkGettingStarted from "../-content/sdk/getting-started.md?raw"
import sdkHeadless from "../-content/sdk/headless.md?raw"
import sdkLimits from "../-content/sdk/limits.md?raw"
import sdkSandbox from "../-content/sdk/sandbox.md?raw"
import sdkSecurity from "../-content/sdk/security.md?raw"
import sdkTheming from "../-content/sdk/theming.md?raw"
import sdkToolsAndWidgets from "../-content/sdk/tools-and-widgets.md?raw"
import startQuickstart from "../-content/start/quickstart.md?raw"
import startTodosTutorial from "../-content/start/todos-tutorial.md?raw"
import dashboardAgents from "../-content/dashboard/agents.md?raw"
import dashboardApiKeys from "../-content/dashboard/api-keys.md?raw"
import dashboardMembers from "../-content/dashboard/members.md?raw"
import dashboardSandboxes from "../-content/dashboard/sandboxes.md?raw"
import dashboardSettings from "../-content/dashboard/settings.md?raw"
import selfHostingConfiguration from "../-content/self-hosting/configuration.md?raw"
import selfHostingDeploy from "../-content/self-hosting/deploy.md?raw"
import selfHostingOperations from "../-content/self-hosting/operations.md?raw"
import selfHostingOverview from "../-content/self-hosting/overview.md?raw"
import selfHostingSecurity from "../-content/self-hosting/security.md?raw"

export interface DocsPage {
  slug: string
  title: string
  markdown: string
  draft?: boolean
}

export interface DocsSection {
  slug: string
  title: string
  description: string
  href?: string
  // Fragment anchors keyed by page slug, for a section whose `href` target renders its own pages.
  anchors?: Record<string, string>
  draft?: boolean
  pages: DocsPage[]
}

export const DOCS_SECTIONS: DocsSection[] = [
  {
    slug: "start",
    title: "Get started",
    description: "TODO",
    draft: true,
    pages: [
      { slug: "quickstart", title: "Quickstart", markdown: startQuickstart },
      { slug: "todos-tutorial", title: "Todos tutorial", markdown: startTodosTutorial },
    ],
  },
  {
    slug: "sdk",
    title: "SDK",
    description: "Embed the agent chat sidebar in your application.",
    pages: [
      { slug: "getting-started", title: "Getting started", markdown: sdkGettingStarted },
      { slug: "authentication", title: "Authentication", markdown: sdkAuthentication },
      { slug: "api", title: "API client", markdown: sdkApi },
      { slug: "configuration", title: "Configuration", markdown: sdkConfiguration },
      { slug: "theming", title: "Theming", markdown: sdkTheming },
      { slug: "tools-and-widgets", title: "Tools and widgets", markdown: sdkToolsAndWidgets },
      { slug: "attachments", title: "Attachments", markdown: sdkAttachments },
      { slug: "limits", title: "Limits", markdown: sdkLimits },
      { slug: "sandbox", title: "Sandbox", markdown: sdkSandbox },
      { slug: "headless", title: "Headless", markdown: sdkHeadless },
      { slug: "security", title: "Security model", markdown: sdkSecurity },
    ],
  },
  {
    slug: "api",
    title: "API",
    description: "Manage your application's Tenants and TenantUsers over HTTP.",
    href: "/docs/api",
    anchors: {
      "getting-started": "description/getting-started",
      authentication: "description/authentication",
      "pagination-and-errors": "description/pagination",
      tenants: "tag/tenants",
      "tenant-users": "tag/tenant_users",
    },
    pages: [],
  },
  {
    slug: "dashboard",
    title: "Dashboard",
    description: "TODO",
    draft: true,
    pages: [
      { slug: "agents", title: "Agents", markdown: dashboardAgents },
      { slug: "sandboxes", title: "Sandboxes", markdown: dashboardSandboxes },
      { slug: "api-keys", title: "API keys", markdown: dashboardApiKeys },
      { slug: "members", title: "Members", markdown: dashboardMembers },
      { slug: "settings", title: "Settings", markdown: dashboardSettings },
    ],
  },
  {
    slug: "self-hosting",
    title: "Self-hosting",
    description: "TODO",
    draft: true,
    pages: [
      { slug: "overview", title: "Overview", markdown: selfHostingOverview },
      { slug: "deploy", title: "Deploy", markdown: selfHostingDeploy },
      { slug: "configuration", title: "Configuration", markdown: selfHostingConfiguration },
      { slug: "operations", title: "Operations", markdown: selfHostingOperations },
      { slug: "security", title: "Security", markdown: selfHostingSecurity },
    ],
  },
]

// A draft section or page stays in the manifest but out of every rendered link, so the prerender
// crawl never reaches it and the lookups below 404 its URL.
export function findDocsSection(sectionSlug: string): DocsSection | undefined {
  return DOCS_SECTIONS.find((section) => !section.draft && section.slug === sectionSlug)
}

export function findDocsPage(section: DocsSection, pageSlug: string): DocsPage | undefined {
  return section.pages.find((page) => !page.draft && page.slug === pageSlug)
}

export function publishedDocsPages(section: DocsSection): DocsPage[] {
  return section.pages.filter((page) => !page.draft)
}
