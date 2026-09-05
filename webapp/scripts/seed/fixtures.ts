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

/**
 * Slugs and names that appear inside more than one seeded record or public ID. Kept in one place
 * so the composed public IDs below cannot drift from the rows the seed writes.
 */
const SEED_NAMES = {
  acme: "acme",
  globex: "globex",
  starterAgent: "assistant",
  todosAgent: "todos",
  todosApiKey: "todos",
  revokedApiKey: "revoked",
  globexApiKey: "demo",
  dockerProvider: "Local Docker",
  todosTenant: "todos-tenant-1",
  todosTenantUser: "todos-user-1",
} as const

/**
 * API key secrets, in Better Auth's `abo_` + 64 letters shape. The seed stores only their SHA-256
 * digests, exactly as the `/organization/api-keys` dialog does; these raw values exist so the
 * todos example and its tests can sign chat tokens without a browser round-trip.
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
 * `provisionOrganizationDefaultAgent` in `src/db/agent.server.ts`; this one is seed-owned on
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
        slug: SEED_NAMES.starterAgent,
        name: "Acme Inc Assistant",
        systemPrompt: SEED_STARTER_AGENT_SYSTEM_PROMPT,
        attachmentsEnabled: true,
        sandboxProviderName: null,
      },
      {
        slug: SEED_NAMES.todosAgent,
        name: "Todos Assistant",
        systemPrompt: SEED_TODOS_AGENT_SYSTEM_PROMPT,
        attachmentsEnabled: true,
        sandboxProviderName: SEED_NAMES.dockerProvider,
      },
    ],
    // The todos agent is the default so the example works with VITE_ASTRALBEAM_AGENT_ID unset.
    defaultAgentSlug: SEED_NAMES.todosAgent,
    apiKeys: [
      {
        slug: SEED_NAMES.todosApiKey,
        name: "Todos example",
        secret: SEED_API_KEY_SECRETS.todos,
        enabled: true,
      },
      {
        slug: SEED_NAMES.revokedApiKey,
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
            admin: false,
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
    slug: SEED_NAMES.globex,
    name: "Globex Corporation",
    members: [{ email: "globex-owner@example.com", role: "owner" }],
    // Exercises the pending-invitation row on the members page without sending email.
    invitations: [{ email: "invitee@example.com", role: "viewer" }],
    sandboxProviders: [],
    agents: [
      {
        slug: SEED_NAMES.starterAgent,
        name: "Globex Corporation Assistant",
        systemPrompt: SEED_STARTER_AGENT_SYSTEM_PROMPT,
        attachmentsEnabled: true,
        sandboxProviderName: null,
      },
    ],
    defaultAgentSlug: SEED_NAMES.starterAgent,
    apiKeys: [
      {
        slug: SEED_NAMES.globexApiKey,
        name: "Globex demo",
        secret: SEED_API_KEY_SECRETS.globex,
        enabled: true,
      },
    ],
    tenants: [],
  },
] as const

/**
 * The one entry point the todos example and its end-to-end suite read. Composed from the same
 * names the rows above use, so a renamed slug cannot leave a stale public ID behind.
 */
export const SEED_TODOS_TARGET = {
  organizationSlug: SEED_NAMES.acme,
  agentId: `agt_${SEED_NAMES.acme}_${SEED_NAMES.todosAgent}`,
  starterAgentId: `agt_${SEED_NAMES.acme}_${SEED_NAMES.starterAgent}`,
  apiKey: `key_${SEED_NAMES.acme}_${SEED_NAMES.todosApiKey}_${SEED_API_KEY_SECRETS.todos}`,
  /** Disabled key: `/api/chat` must reject a token signed with it. */
  revokedApiKey:
    `key_${SEED_NAMES.acme}_${SEED_NAMES.revokedApiKey}_${SEED_API_KEY_SECRETS.revoked}`,
  /** Another organization's key: its tokens must not reach an `acme` agent. */
  foreignApiKey:
    `key_${SEED_NAMES.globex}_${SEED_NAMES.globexApiKey}_${SEED_API_KEY_SECRETS.globex}`,
  /** Matches DEMO_CHAT_TENANT and DEMO_CHAT_USER in `examples/todos/src/lib/constants.server.ts`. */
  tenant: { id: SEED_NAMES.todosTenant, name: "Todos Example" },
  user: {
    id: SEED_NAMES.todosTenantUser,
    name: "Ada Lovelace",
    metadata: { email: "ada@example.com" },
  },
} as const
