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
    draft: false,
    pages: [
      {
        slug: "quickstart",
        title: "Quickstart",
        description:
          "Embed an agent in your application, configure a model, create an API key, and stream your first reply.",
      },
      {
        slug: "todos-tutorial",
        title: "Todos tutorial",
        description:
          "Build an agent that manages a todo list with host tools, interactive widgets, file attachments, and a sandbox.",
      },
    ],
  },
  {
    slug: "sdk",
    title: "SDK",
    description: "Embed the agent chat sidebar in your application.",
    pages: [
      {
        slug: "getting-started",
        title: "Getting started",
        description:
          "Install the SDK, mount the chat widget in React or JavaScript, and connect a secure token endpoint.",
      },
      {
        slug: "script-tag",
        title: "Script tag",
        description:
          "Embed the agent sidebar with a script tag, without a bundler, including a complete Ruby on Rails integration.",
      },
      {
        slug: "authentication",
        title: "Authentication",
        description:
          "Connect your signed-in users to embedded chat and tenant directories with short-lived JWTs and server-held API keys.",
      },
      {
        slug: "api",
        title: "API client",
        description:
          "Manage Tenants and TenantUsers with the SDK API client from your server or an authorized browser session.",
      },
      {
        slug: "listings",
        title: "Tenant directories",
        description:
          "Embed tenant, user, and conversation directories with access scoped to the current tenant.",
      },
      {
        slug: "configuration",
        title: "Configuration",
        description:
          "Configure the chat widget, update its options, and customize the React component or vanilla JavaScript handle.",
      },
      {
        slug: "theming",
        title: "Theming",
        description:
          "Customize the chat widget with light and dark color schemes, CSS tokens, and isolated shadow-root styles.",
      },
      {
        slug: "tools-and-widgets",
        title: "Tools and widgets",
        description:
          "Connect agent tools to your application state and render interactive UI components inside chat replies.",
      },
      {
        slug: "attachments",
        title: "Attachments",
        description:
          "Let users attach files by upload, drag and drop, or paste, and control how the agent reads them.",
      },
      {
        slug: "limits",
        title: "Limits",
        description:
          "Understand server-enforced chat limits and configure narrower limits in the SDK composer.",
      },
      {
        slug: "sandbox",
        title: "Sandbox",
        description:
          "Enable agent file operations, command execution, and downloadable results with a configured sandbox provider.",
      },
      {
        slug: "headless",
        title: "Headless",
        description:
          "Build your own chat UI using the headless authentication, transport, tool, and transcript APIs.",
      },
      {
        slug: "security",
        title: "Security model",
        description:
          "Understand the permission boundary between the dashboard, chat endpoint, and embedded client.",
      },
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
    slug: "cli",
    title: "CLI",
    description: "Manage your organization from the terminal, by hand or through coding agents.",
    pages: [
      {
        slug: "getting-started",
        title: "Getting started",
        description:
          "Install the CLI, authenticate with an organization API key, and manage your first Tenant and TenantUser.",
      },
      {
        slug: "commands",
        title: "Commands",
        description:
          "Look up CLI commands, flags, output formats, and exit codes for organization administration and automation.",
      },
      {
        slug: "coding-agents",
        title: "Coding agents",
        description:
          "Give coding agents the bundled CLI skill and scoped credentials to manage your organization safely.",
      },
    ],
  },
  {
    slug: "dashboard",
    title: "Dashboard",
    description:
      "Configure the models, agents, sandboxes, usage limits, keys, and members your organization uses.",
    draft: false,
    pages: [
      {
        slug: "models",
        title: "Models",
        description:
          "Connect model providers, enable their models, and assign them to agents in your organization.",
      },
      {
        slug: "connections",
        title: "MCP servers",
        description:
          "Configure remote MCP servers, authorize connections, and make their tools available to your agents.",
      },
      {
        slug: "agents",
        title: "Agents",
        description:
          "Configure agent instructions, models, attachments, and tools, then select an agent in your application.",
      },
      {
        slug: "sandboxes",
        title: "Sandboxes",
        description:
          "Connect sandbox providers and assign isolated code execution workspaces to your agents.",
      },
      {
        slug: "usage-limits",
        title: "Usage limits",
        description:
          "Set token and model-spend allowances by tenant, user, or conversation, with examples for subscription plans.",
      },
      {
        slug: "api-keys",
        title: "API keys",
        description:
          "Create and manage organization API keys for server-side integrations and tenant chat authentication.",
      },
      {
        slug: "members",
        title: "Members",
        description:
          "Invite employees to the dashboard and manage organization membership separately from tenant users.",
      },
      {
        slug: "settings",
        title: "Settings",
        description:
          "Edit your organization name and URL slug, and find the settings for other organization resources.",
      },
    ],
  },
  {
    slug: "self-hosting",
    title: "Self-hosting",
    description: "Run and operate the platform on your own infrastructure.",
    draft: false,
    pages: [
      {
        slug: "overview",
        title: "Overview",
        description:
          "Understand the application process, PostgreSQL database, and private object storage needed to self-host the platform.",
      },
      {
        slug: "deploy",
        title: "Deploy",
        description:
          "Deploy the platform on Linux with PostgreSQL, a connection pooler, systemd, and an HTTPS reverse proxy.",
      },
      {
        slug: "configuration",
        title: "Configuration",
        description:
          "Configure database-backed application settings and environment overrides for your self-hosted deployment.",
      },
      {
        slug: "operations",
        title: "Operations",
        description:
          "Operate a self-hosted deployment with migrations, backups, monitoring, and recovery procedures.",
      },
      {
        slug: "security",
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
export function docsSitemapPaths(): string[] {
  return [
    "/docs",
    ...DOCS_SECTIONS.filter((section) => !section.draft).flatMap((section) =>
      section.href
        ? [section.href]
        : publishedDocsPages(section).map((page) => `/docs/${section.slug}/${page.slug}`),
    ),
  ]
}

export function loadDocsMarkdown(sectionSlug: string, pageSlug: string): Promise<string> {
  const load = docsMarkdownByPath[`/src/routes/docs/-content/${sectionSlug}/${pageSlug}.md`]
  if (!load) throw new Error(`Unregistered docs Markdown: ${sectionSlug}/${pageSlug}`)
  return load()
}
