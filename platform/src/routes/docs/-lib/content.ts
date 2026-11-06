// Docs are authored as plain Markdown under -content/<section>/ and registered here; the
// section and page order in this manifest is the order the navigation shows.

// Bodies load per page, so /docs and each article ship only the Markdown they render. The api
// directory is excluded because it feeds the OpenAPI description, not a route of its own.
// https://vite.dev/guide/features#glob-import
const docsMarkdownByPath = import.meta.glob<string>(
  ["/src/routes/docs/-content/*/*.md", "!/src/routes/docs/-content/api/*.md"],
  { query: "?raw", import: "default" },
)

export interface DocsPage {
  slug: string
  title: string
  description: string
  // Last substantive Markdown revision, kept as a static ISO date.
  updated: string
  // Hidden from navigation, the prerender crawl, and routing. The Markdown stays in the public
  // repository and its chunk stays fetchable, so this is unpublished, not embargoed.
  draft?: boolean
}

export interface DocsSection {
  slug: string
  title: string
  description: string
  href?: string
  // Revision date for a destination that renders its own content, such as the API reference.
  updated?: string
  // Fragment anchors keyed by page slug, for a section whose `href` target renders its own pages.
  anchors?: Record<string, string>
  draft?: boolean
  pages: DocsPage[]
}

export const DOCS_SECTIONS: DocsSection[] = [
  {
    slug: "start",
    title: "Get started",
    description: "Add your first assistant, then connect tools and live widgets.",
    draft: false,
    pages: [
      {
        slug: "quickstart",
        updated: "2026-11-06",
        title: "Quickstart",
        description:
          "Add chat to your React app with your existing login and send your first message.",
      },
      {
        slug: "customize",
        updated: "2026-11-06",
        title: "Customize your setup",
        description:
          "Identify real users, shape your agent, choose models, control spend, and match your brand.",
      },
      {
        slug: "todos-tutorial",
        updated: "2026-11-05",
        title: "Todos tutorial",
        description: "Connect an assistant to a todo list with tools and live cards in chat.",
      },
      {
        slug: "coding-agents",
        updated: "2026-11-06",
        title: "Coding agents",
        description: "Add AstralBeam to your app with a coding agent and the AstralBeam skill.",
      },
    ],
  },
  {
    slug: "sdk",
    title: "SDK",
    description: "Embed chat in React or JavaScript and connect it to your app.",
    pages: [
      {
        slug: "getting-started",
        updated: "2026-11-05",
        title: "Getting started",
        description:
          "Install the SDK, mount the chat widget in React or JavaScript, and connect a secure token endpoint.",
      },
      {
        slug: "script-tag",
        updated: "2026-11-05",
        title: "Script tag",
        description:
          "Embed the agent sidebar with a script tag, without a bundler, including a complete Ruby on Rails integration.",
      },
      {
        slug: "authentication",
        updated: "2026-11-05",
        title: "Authentication",
        description:
          "Connect your signed-in users to embedded chat and tenant directories with short-lived JWTs and server-held API keys.",
      },
      {
        slug: "api",
        updated: "2026-11-05",
        title: "API client",
        description:
          "Manage Tenants and TenantUsers with the SDK API client from your server or an authorized browser session.",
      },
      {
        slug: "listings",
        updated: "2026-11-05",
        title: "Tenant directories",
        description:
          "Embed tenant, user, and conversation directories with access scoped to the current tenant.",
      },
      {
        slug: "configuration",
        updated: "2026-11-05",
        title: "Configuration",
        description:
          "Configure the chat widget, update its options, and customize the React component or vanilla JavaScript handle.",
      },
      {
        slug: "theming",
        updated: "2026-11-05",
        title: "Theming",
        description:
          "Customize the chat widget with light and dark color schemes, CSS tokens, and isolated shadow-root styles.",
      },
      {
        slug: "tools-and-widgets",
        updated: "2026-11-05",
        title: "Tools and widgets",
        description:
          "Connect agent tools to your application state and render interactive UI components inside chat replies.",
      },
      {
        slug: "attachments",
        updated: "2026-11-05",
        title: "Attachments",
        description:
          "Let users attach files by upload, drag and drop, or paste, and control how the agent reads them.",
      },
      {
        slug: "limits",
        updated: "2026-11-05",
        title: "Limits",
        description:
          "Understand server-enforced chat limits and configure narrower limits in the SDK composer.",
      },
      {
        slug: "sandbox",
        updated: "2026-11-05",
        title: "Sandbox",
        description:
          "Enable agent file operations, command execution, and downloadable results with a configured sandbox provider.",
      },
      {
        slug: "headless",
        updated: "2026-11-05",
        title: "Headless",
        description:
          "Build your own chat UI using the headless authentication, transport, tool, and transcript APIs.",
      },
      {
        slug: "security",
        updated: "2026-11-05",
        title: "Security model",
        description:
          "Understand the permission boundary between the dashboard, chat endpoint, and embedded client.",
      },
    ],
  },
  {
    slug: "api",
    title: "API",
    description: "Manage customer accounts and users from your backend.",
    href: "/docs/api",
    updated: "2026-11-05",
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
    description: "Set up your agents and manage your team's access and usage.",
    draft: false,
    pages: [
      {
        slug: "models",
        updated: "2026-11-06",
        title: "Models",
        description:
          "Connect model providers, enable their models, and assign them to agents in your organization.",
      },
      {
        slug: "connections",
        updated: "2026-11-05",
        title: "MCP servers",
        description:
          "Configure remote MCP servers, authorize connections, and make their tools available to your agents.",
      },
      {
        slug: "agents",
        updated: "2026-11-06",
        title: "Agents",
        description:
          "Configure agent instructions, models, attachments, and tools, then select an agent in your application.",
      },
      {
        slug: "sandboxes",
        updated: "2026-11-05",
        title: "Sandboxes",
        description:
          "Connect sandbox providers and assign isolated code execution workspaces to your agents.",
      },
      {
        slug: "usage-limits",
        updated: "2026-11-06",
        title: "Usage limits",
        description:
          "Set token and model-spend allowances by tenant, user, or conversation, with examples for subscription plans.",
      },
      {
        slug: "api-keys",
        updated: "2026-11-05",
        title: "API keys",
        description:
          "Create and manage organization API keys for server-side integrations and tenant chat authentication.",
      },
      {
        slug: "members",
        updated: "2026-11-05",
        title: "Members",
        description:
          "Invite employees to the dashboard and manage organization membership separately from tenant users.",
      },
      {
        slug: "settings",
        updated: "2026-11-05",
        title: "Settings",
        description:
          "Edit your organization name and URL slug, and find the settings for other organization resources.",
      },
    ],
  },
  {
    slug: "self-hosting",
    title: "Self-hosting",
    description: "Deploy AstralBeam and maintain it on your own infrastructure.",
    draft: false,
    pages: [
      {
        slug: "overview",
        updated: "2026-11-05",
        title: "Overview",
        description:
          "Run the agent backend with PostgreSQL and local or S3-compatible file storage on your own infrastructure.",
      },
      {
        slug: "deploy",
        updated: "2026-11-06",
        title: "Deploy",
        description: "Install the standalone binary or run AstralBeam with Docker Compose.",
      },
      {
        slug: "configuration",
        updated: "2026-11-06",
        title: "Configuration",
        description:
          "Configure database-backed application settings and environment overrides for your self-hosted deployment.",
      },
      {
        slug: "operations",
        updated: "2026-11-05",
        title: "Operations",
        description:
          "Operate a self-hosted deployment with migrations, backups, monitoring, and recovery procedures.",
      },
      {
        slug: "security",
        updated: "2026-11-05",
        title: "Security",
        description:
          "Secure a self-hosted deployment with encryption keys, network boundaries, and controlled access to services.",
      },
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

export function findDocsArticleNeighbors({
  sections,
  sectionSlug,
  pageSlug,
}: {
  sections: DocsSection[]
  sectionSlug: string
  pageSlug: string
}) {
  const entries = sections
    .filter((section) => !section.draft && !section.href)
    .flatMap((section) => publishedDocsPages(section).map((page) => ({ section, page })))
  const position = entries.findIndex(
    ({ section, page }) => section.slug === sectionSlug && page.slug === pageSlug,
  )
  return {
    previous: position < 0 ? undefined : entries[position - 1],
    next: position < 0 ? undefined : entries[position + 1],
  }
}

/** Crawlable docs paths: drafts are unlisted, and a bare section URL is only a redirect. */
export function docsSitemapEntries(): { path: string; lastmod: string }[] {
  const entries = DOCS_SECTIONS.filter((section) => !section.draft).flatMap((section) =>
    section.href
      ? [{ path: section.href, lastmod: section.updated! }]
      : publishedDocsPages(section).map((page) => ({
          path: `/docs/${section.slug}/${page.slug}`,
          lastmod: page.updated,
        })),
  )
  const latestUpdate = entries
    .map((entry) => entry.lastmod)
    .sort()
    .at(-1)!
  return [{ path: "/docs", lastmod: latestUpdate }, ...entries]
}

export function loadDocsMarkdown(sectionSlug: string, pageSlug: string): Promise<string> {
  const load = docsMarkdownByPath[`/src/routes/docs/-content/${sectionSlug}/${pageSlug}.md`]
  if (!load) throw new Error(`Unregistered docs Markdown: ${sectionSlug}/${pageSlug}`)
  return load()
}
