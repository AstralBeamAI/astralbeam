// Docs are authored as plain Markdown under -content/<section>/ and registered here; the
// section and page order in this manifest is the order the navigation shows.

// Bodies load per page, so /docs and each article ship only the Markdown they render. The api
// directory is excluded because it feeds the OpenAPI description, not a route of its own.
// https://vite.dev/guide/features#glob-import
const docsMarkdownByPath = import.meta.glob<string>([
  "/src/routes/docs/-content/*/*.md",
  "!/src/routes/docs/-content/api/*.md",
], { query: "?raw", import: "default" })

export interface DocsPage {
  slug: string
  title: string
  // Hidden from navigation, the prerender crawl, and routing. The Markdown stays in the public
  // repository and its chunk stays fetchable, so this is unpublished, not embargoed.
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
    description: "Go from a new organization to a working embedded agent.",
    draft: true,
    pages: [
      { slug: "quickstart", title: "Quickstart" },
      { slug: "todos-tutorial", title: "Todos tutorial" },
    ],
  },
  {
    slug: "sdk",
    title: "SDK",
    description: "Embed the agent chat sidebar in your application.",
    pages: [
      { slug: "getting-started", title: "Getting started" },
      { slug: "authentication", title: "Authentication" },
      { slug: "api", title: "API client" },
      { slug: "configuration", title: "Configuration" },
      { slug: "theming", title: "Theming" },
      { slug: "tools-and-widgets", title: "Tools and widgets" },
      { slug: "attachments", title: "Attachments" },
      { slug: "limits", title: "Limits" },
      { slug: "sandbox", title: "Sandbox" },
      { slug: "headless", title: "Headless" },
      { slug: "security", title: "Security model" },
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
    description: "Configure the agents, sandboxes, keys, and members your organization uses.",
    draft: true,
    pages: [
      { slug: "agents", title: "Agents" },
      { slug: "sandboxes", title: "Sandboxes" },
      { slug: "api-keys", title: "API keys" },
      { slug: "members", title: "Members" },
      { slug: "settings", title: "Settings" },
    ],
  },
  {
    slug: "self-hosting",
    title: "Self-hosting",
    description: "Run and operate the platform on your own infrastructure.",
    draft: true,
    pages: [
      { slug: "overview", title: "Overview" },
      { slug: "deploy", title: "Deploy" },
      { slug: "configuration", title: "Configuration" },
      { slug: "operations", title: "Operations" },
      { slug: "security", title: "Security" },
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

export function loadDocsMarkdown(sectionSlug: string, pageSlug: string): Promise<string> {
  const load = docsMarkdownByPath[`/src/routes/docs/-content/${sectionSlug}/${pageSlug}.md`]
  if (!load) throw new Error(`Unregistered docs Markdown: ${sectionSlug}/${pageSlug}`)
  return load()
}
