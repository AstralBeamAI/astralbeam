/**
 * Deterministic sample data shared by `deno task db-seed` and the todos end-to-end suite.
 *
 * `examples/todos/e2e` imports this module across a project boundary, so it must stay free of
 * imports and runtime dependencies: it is plain data only. Every credential-shaped value here is
 * a development placeholder, like the checked-in `DATABASE_ENCRYPTION_KEY` in `.env.development`,
 * and `scripts/seed-database.ts` refuses any database host that is not loopback so these values
 * cannot reach a real deployment.
 */

/** Shared sign-in password. Long enough for Better Auth's 12-character minimum. */
export const SEED_PASSWORD = "astralbeam-seed-password"

export const SEED_DOGFOOD = {
  organizationId: "01990a5d-0000-7000-8000-000000000013",
  agentId: "01990a5d-0000-7000-8000-000000000004",
  apiKeyId: "01990a5d-0000-7000-8000-000000000024",
  secret: "abo_DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
  ownerEmail: "owner@example.com",
  name: "dogfood",
  slug: "dogfood",
} as const

export const SEED_MODEL_PROVIDER = {
  name: "Development OpenAI",
  modelId: "gpt-5.6-terra",
  modelName: "GPT-5.6 Terra",
} as const

/** Shared fixture names for dashboard routes, providers, and tenant identity. */
const SEED_NAMES = {
  acme: "acme",
  globex: "globex",
  dockerProvider: "Local Docker",
  todosTenant: "todos-tenant-1",
  todosTenantUser: "todos-user-1",
} as const

const SEED_ORGANIZATION_IDS = {
  acme: "01990a5d-0000-7000-8000-000000000011",
  globex: "01990a5d-0000-7000-8000-000000000012",
} as const

const SEED_API_KEY_IDS = {
  todos: "01990a5d-0000-7000-8000-000000000021",
  revoked: "01990a5d-0000-7000-8000-000000000022",
  globex: "01990a5d-0000-7000-8000-000000000023",
} as const

/**
 * Fixed agent IDs. Agents carry no slug, so the seed writes these explicit values rather than
 * letting the database generate them, which keeps `SEED_TODOS_TARGET` composable without a query.
 */
const SEED_AGENT_IDS = {
  acmeStarter: "01990a5d-0000-7000-8000-000000000001",
  acmeTodos: "01990a5d-0000-7000-8000-000000000002",
  globexStarter: "01990a5d-0000-7000-8000-000000000003",
} as const

/**
 * API key secrets, in Better Auth's `abo_` + 64 letters shape. The seed stores only their SHA-256
 * digests, exactly as the `/:organizationSlug/api-keys` dialog does; these raw values exist so the
 * todos example and its tests can sign chat auth tokens without a browser round-trip.
 */
const SEED_API_KEY_SECRETS = {
  todos: "abo_AcmeTodosSeedKeyForLocalDevelopmentOnlyNotASecretDoNotDeployThis",
  revoked: "abo_AcmeRevokedSeedKeyForLocalDevelopmentOnlyNotASecretDoNotDeployIt",
  globex: "abo_GlobexDemoSeedKeyForLocalDevelopmentOnlyNotASecretDoNotDeployNow",
} as const

/**
 * Global configuration the seed writes when no uppercase environment variable already supplies it.
 * These are the keys `validateConfigCompleteness` in `src/lib/config/registry.server.ts` marks
 * required; add a key here when that function starts requiring another one, or the application
 * will redirect to `/configure` after a seed.
 *
 * The Turnstile values are Cloudflare's published always-pass test keys, the same pair
 * `.env.development` sets. https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export const SEED_CONFIG_VALUES = {
  app_base_url: "http://localhost:4500",
  better_auth_secret: "onlyForDevelopmentNotASecretSeedBetterAuthKey",
  turnstile_site_key: "1x00000000000000000000AA",
  turnstile_secret_key: "1x0000000000000000000000000000000AA",
  support_email_address: "support@example.com",
} as const

/** Dashboard accounts, created already email-verified so no SMTP sink is needed to sign in. */
export const SEED_USERS = [
  { email: "owner@example.com", name: "Ada Owner" },
  { email: "developer@example.com", name: "Dev Developer" },
  { email: "viewer@example.com", name: "Vic Viewer" },
  { email: "globex-owner@example.com", name: "Hank Scorpio" },
] as const

/**
 * The agent prompt the todos example expects, duplicated from `examples/todos/README.md` so the
 * seed installs it without anyone pasting it into the dashboard. Keep the two copies in step.
 */
const SEED_TODOS_AGENT_SYSTEM_PROMPT =
  "You are the assistant inside a personal todo-list app. The user manages a flat list of todos, each with an id, a text, and a completed flag. Use the tools to read and change the list instead of guessing its contents. Always show todos through the todoCard widget rather than describing them in prose: render one card per todo you are showing, each with that todo's id, including when the user asks to see the whole list. When the user attaches a file or a screenshot, read it and turn what it lists into todos with the tools, then show the cards for what you created. If your sandbox tools are available, use the sandbox for work the todo tools cannot do — writing a script to export the list, crunching dates for a schedule, or generating a file the user asked for — and keep using the todo tools for the list itself."

/**
 * Prompt for each organization's starter agent. A real organization gets its own wording from
 * `Agents.provisionDefault` in `src/lib/agents/agents.server.ts`; this one is seed-owned on
 * purpose, so changing that default never leaves a stale copy here.
 */
const SEED_STARTER_AGENT_SYSTEM_PROMPT =
  "You are the starter assistant for a seeded development organization. Help whoever is testing this application, act only through the tools and widgets the host page declares, and say plainly when a request is outside what you can do."

/**
 * Docker is the one provider that stores no credentials, so it is the only one a seed can install
 * without inventing a secret. `lastTest` stays null: it is display-only on the sandboxes page and
 * the chat endpoint never reads it. https://docs.docker.com/engine/install/
 */
const SEED_DOCKER_SANDBOX_PROVIDER = {
  name: SEED_NAMES.dockerProvider,
  providerType: "docker",
  options: { image: "node:22" },
} as const

export const SEED_ORGANIZATIONS = [
  {
    id: SEED_ORGANIZATION_IDS.acme,
    slug: SEED_NAMES.acme,
    name: "Acme Inc",
    members: [
      { email: "owner@example.com", role: "owner" },
      { email: "developer@example.com", role: "developer" },
      { email: "viewer@example.com", role: "viewer" },
    ],
    invitations: [],
    sandboxProviders: [SEED_DOCKER_SANDBOX_PROVIDER],
    agents: [
      {
        id: SEED_AGENT_IDS.acmeStarter,
        name: "Acme Inc Assistant",
        systemPrompt: SEED_STARTER_AGENT_SYSTEM_PROMPT,
        attachmentsEnabled: true,
        sandboxProviderName: null,
      },
      {
        id: SEED_AGENT_IDS.acmeTodos,
        name: "Todos Assistant",
        systemPrompt: SEED_TODOS_AGENT_SYSTEM_PROMPT,
        attachmentsEnabled: true,
        sandboxProviderName: SEED_NAMES.dockerProvider,
      },
    ],
    // The todos agent is the default so the example works with VITE_ASTRALBEAM_AGENT_ID unset.
    defaultAgentId: SEED_AGENT_IDS.acmeTodos,
    apiKeys: [
      {
        id: SEED_API_KEY_IDS.todos,
        name: "Todos example",
        secret: SEED_API_KEY_SECRETS.todos,
        enabled: true,
      },
      {
        id: SEED_API_KEY_IDS.revoked,
        name: "Revoked key",
        secret: SEED_API_KEY_SECRETS.revoked,
        enabled: false,
      },
    ],
    tenants: [
      {
        externalId: SEED_NAMES.todosTenant,
        name: "Todos Example",
        users: [
          {
            externalId: SEED_NAMES.todosTenantUser,
            name: "Ada Lovelace",
            admin: true,
            metadata: { email: "ada@example.com" },
          },
        ],
      },
      {
        externalId: "northwind",
        name: "Northwind Traders",
        users: [
          {
            externalId: "northwind-admin",
            name: "Nancy Admin",
            admin: true,
            metadata: { email: "nancy@northwind.example" },
          },
          {
            externalId: "northwind-member",
            name: "Ned Member",
            admin: false,
            metadata: { email: "ned@northwind.example" },
          },
        ],
      },
    ],
  },
  {
    id: SEED_ORGANIZATION_IDS.globex,
    slug: SEED_NAMES.globex,
    name: "Globex Corporation",
    members: [{ email: "globex-owner@example.com", role: "owner" }],
    // Exercises the pending-invitation row on the members page without sending email.
    invitations: [{ email: "invitee@example.com", role: "viewer" }],
    sandboxProviders: [],
    agents: [
      {
        id: SEED_AGENT_IDS.globexStarter,
        name: "Globex Corporation Assistant",
        systemPrompt: SEED_STARTER_AGENT_SYSTEM_PROMPT,
        attachmentsEnabled: true,
        sandboxProviderName: null,
      },
    ],
    defaultAgentId: SEED_AGENT_IDS.globexStarter,
    apiKeys: [
      {
        id: SEED_API_KEY_IDS.globex,
        name: "Globex demo",
        secret: SEED_API_KEY_SECRETS.globex,
        enabled: true,
      },
    ],
    tenants: [],
  },
] as const

/**
 * Saved conversations with fixed thread IDs, for the todos tenant user and for the `acme` owner's
 * Astro identity, so history and transcript views have content without a model call.
 */
export const SEED_CONVERSATIONS = {
  todos: [
    {
      id: "01990a5d-0000-7000-8000-000000000031",
      title: "Plan the product launch",
      hoursAgo: 2,
      turns: [
        [
          "Break the launch into todos for this week.",
          "I added four todos: draft the announcement, record the demo video, update the pricing page, and email the beta list.",
        ],
        [
          "Move the demo video to Friday.",
          "Done. The demo video todo now says Friday, and the other three are unchanged.",
        ],
      ],
    },
    {
      id: "01990a5d-0000-7000-8000-000000000032",
      title: "Groceries for the weekend",
      hoursAgo: 26,
      turns: [
        [
          "Add eggs, spinach, and coffee beans.",
          "Added three todos: eggs, spinach, and coffee beans.",
        ],
      ],
    },
    {
      id: "01990a5d-0000-7000-8000-000000000033",
      title: "Tidy up completed todos",
      hoursAgo: 72,
      turns: [
        [
          "Which todos are already done?",
          "Two are complete: renew the passport and book the dentist. Want me to delete them?",
        ],
        ["Yes, delete both.", "Deleted both completed todos."],
      ],
    },
  ],
  astro: [
    {
      id: "01990a5d-0000-7000-8000-000000000041",
      title: "Embed the chat widget",
      hoursAgo: 1,
      turns: [
        [
          "How do I add the chat widget to my app?",
          "Create an API key under API keys, mint a chat token from your server with `createAstralBeamToken`, then mount `AstralBeamChat` with your agent ID.",
        ],
      ],
    },
    {
      id: "01990a5d-0000-7000-8000-000000000042",
      title: "Which model does the todos agent use?",
      hoursAgo: 30,
      turns: [
        [
          "Which model does the Todos Assistant use?",
          "It uses the Development OpenAI connection. You can change its ordered models on the agent's configuration page.",
        ],
        [
          "Can it run code?",
          "Yes. The Todos Assistant has the Local Docker sandbox provider, so it can run commands and write files.",
        ],
      ],
    },
  ],
} as const

/**
 * The one entry point the todos example and its end-to-end suite read. Composed from the same
 * IDs the rows above use, so fixture credentials always identify the persisted rows.
 */
export const SEED_TODOS_TARGET = {
  organizationSlug: SEED_NAMES.acme,
  organizationId: SEED_ORGANIZATION_IDS.acme,
  apiKeyId: SEED_API_KEY_IDS.todos,
  agentId: `agent_${SEED_ORGANIZATION_IDS.acme}_${SEED_AGENT_IDS.acmeTodos}`,
  apiKey: `key_${SEED_ORGANIZATION_IDS.acme}_${SEED_API_KEY_IDS.todos}_${SEED_API_KEY_SECRETS.todos}`,
  /** Disabled key: `/api/v1/chat` must reject a token signed with it. */
  revokedApiKey: `key_${SEED_ORGANIZATION_IDS.acme}_${SEED_API_KEY_IDS.revoked}_${SEED_API_KEY_SECRETS.revoked}`,
  /** Another organization's key: its tokens must not reach an `acme` agent. */
  foreignApiKey: `key_${SEED_ORGANIZATION_IDS.globex}_${SEED_API_KEY_IDS.globex}_${SEED_API_KEY_SECRETS.globex}`,
  /** Matches DEMO_CHAT_TENANT and DEMO_CHAT_USER in `examples/todos/src/lib/constants.server.ts`. */
  tenant: { id: SEED_NAMES.todosTenant, name: "Todos Example" },
  user: {
    id: SEED_NAMES.todosTenantUser,
    name: "Ada Lovelace",
    admin: true,
    metadata: { email: "ada@example.com" },
  },
} as const
