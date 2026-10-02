import { and, eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"

const modelProviderIntegration = vi.hoisted(() => {
  const configured = globalThis.process.env.DATABASE_URL
  const url = configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
  if (url) {
    const parsed = new URL(url)
    if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.endsWith("_test"))
      throw new Error("Use a disposable loopback database ending in _test")
  }
  return { url }
})

import { getAuthDatabase } from "@/db/database.server"
import {
  agent,
  agentModel,
  modelProvider,
  organization,
  organizationConfiguration,
} from "@/db/schema.server"
import { Agents } from "@/lib/agents/agents.server"
import { Config } from "@/lib/config/config.server"
import { formatAgentId } from "@/lib/agents/schemas"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { ModelProviders, type SaveModelProviderInput } from "./model-providers.server.ts"

const modelIntegrationKey = `sk-${"x".repeat(32)}`

function saveIntegrationProvider(
  organizationId: string,
  fields: Partial<SaveModelProviderInput> = {},
) {
  return Effect.flatMap(ModelProviders, (providers) =>
    providers.save({
      organizationId,
      id: null,
      lockVersion: null,
      name: "Production",
      providerType: "openai",
      api: "responses",
      baseUrl: "https://api.openai.com/v1",
      apiKey: modelIntegrationKey,
      models: [{ modelId: "same-model", name: "Shared model name" }],
      ...fields,
    }),
  )
}

describe.skipIf(!modelProviderIntegration.url)("model provider persistence", () => {
  let db: ReturnType<typeof getAuthDatabase>
  let organizationId: string
  let agentId: string
  beforeEach(async () => {
    db = getAuthDatabase()
    await db.execute(sql`truncate "organization" cascade`)
    const [created] = await db
      .insert(organization)
      .values({ name: "Models", slug: "models" })
      .returning()
    organizationId = created!.id
    const [createdAgent] = await db
      .insert(agent)
      .values({ organizationId, name: "Assistant", systemPrompt: "Help" })
      .returning()
    agentId = createdAgent!.id
  })

  test("keeps identical upstream models in distinct provider instances and binds ciphertext to its row", async () => {
    await runAppEffect(saveIntegrationProvider(organizationId))
    const gatewayId = await runAppEffect(
      saveIntegrationProvider(organizationId, {
        name: "Gateway",
        providerType: "openai",
        api: "chat-completions",
        baseUrl: "https://gateway.example/v1",
        apiKey: "gateway-secret",
      }),
    )
    const providers = await runAppEffect(
      Effect.flatMap(ModelProviders, (service) => service.list({ organizationId })),
    )
    expect(providers).toHaveLength(2)
    const gateway = providers.find((provider) => provider.id === gatewayId)!
    const production = providers.find((provider) => provider.id !== gatewayId)!
    expect(gateway.models[0]!.id).not.toBe(production.models[0]!.id)
    expect(JSON.stringify(providers)).not.toContain(modelIntegrationKey)
    expect(JSON.stringify(providers)).not.toContain("gateway-secret")
    await db
      .insert(agentModel)
      .values({ organizationId, agentId, providerModelId: gateway.models[0]!.id, position: 0 })
    const configuration = await runAppEffect(
      Effect.flatMap(ModelProviders, (service) =>
        service.resolveForAgent({ organizationId, agentId }),
      ),
    )
    expect(configuration).toMatchObject({
      apiKey: "gateway-secret",
      baseUrl: "https://gateway.example/v1",
      modelId: "same-model",
      providerId: gatewayId,
      api: "chat-completions",
    })
    const [source] = await db
      .select({ ciphertext: sql<string>`${modelProvider.credentials}::text` })
      .from(modelProvider)
      .where(
        and(eq(modelProvider.organizationId, organizationId), eq(modelProvider.id, production.id)),
      )
    await db.execute(
      sql`update model_provider set credentials = ${source!.ciphertext}, updated_at = now() where organization_id = ${organizationId} and id = ${gatewayId}`,
    )
    const refused = await runAppEffect(
      Effect.flatMap(ModelProviders, (service) =>
        service.resolveForAgent({ organizationId, agentId }),
      ).pipe(Effect.flip),
    )
    expect(refused._tag).toBe("ModelProviderUnreadable")
  })

  test("rejects foreign model assignments and protects models in use, including stale provider writes", async () => {
    const providerId = await runAppEffect(saveIntegrationProvider(organizationId))
    const provider = await runAppEffect(
      Effect.flatMap(ModelProviders, (service) => service.get({ organizationId, id: providerId })),
    )
    const modelId = provider!.models[0]!.id
    const [foreign] = await db
      .insert(organization)
      .values({ name: "Foreign", slug: "foreign" })
      .returning()
    const refusal = await runAppEffect(
      Effect.flatMap(Agents, (service) =>
        service.create({
          organizationId: foreign!.id,
          fields: {
            name: "Foreign agent",
            systemPrompt: "Help",
            attachmentsEnabled: true,
            sandboxProviderId: null,
            modelIds: [modelId],
          },
        }),
      ).pipe(Effect.flip),
    )
    expect(refusal._tag).toBe("AgentModelInvalid")
    expect(await db.select().from(agent).where(eq(agent.organizationId, foreign!.id))).toEqual([])
    await db
      .insert(agentModel)
      .values({ organizationId, agentId, providerModelId: modelId, position: 0 })
    const disable = await runAppEffect(
      saveIntegrationProvider(organizationId, {
        id: providerId,
        lockVersion: 0,
        models: [],
        apiKey: null,
      }).pipe(Effect.flip),
    )
    expect(disable.message).toBe(
      "Remove these models from the agent Assistant before disabling them or deleting the provider",
    )
    const remove = await runAppEffect(
      Effect.flatMap(ModelProviders, (service) =>
        service.remove({ organizationId, id: providerId, lockVersion: 0 }),
      ).pipe(Effect.flip),
    )
    expect(remove.message).toBe(disable.message)
    await runAppEffect(
      saveIntegrationProvider(organizationId, {
        id: providerId,
        lockVersion: 0,
        name: "Renamed",
        apiKey: null,
      }),
    )
    const stale = await runAppEffect(
      saveIntegrationProvider(organizationId, {
        id: providerId,
        lockVersion: 0,
        apiKey: null,
      }).pipe(Effect.flip),
    )
    expect(stale._tag).toBe("ModelProviderChanged")
  })

  test("refuses private provider endpoints unless the deployment allows them", async () => {
    for (const baseUrl of ["http://169.254.169.254/latest", "https://127.0.0.1:11434/v1"]) {
      const refused = await runAppEffect(
        saveIntegrationProvider(organizationId, { baseUrl }).pipe(Effect.flip),
      )
      expect(refused._tag).toBe("ModelProviderEndpointNotAllowed")
    }
    vi.stubEnv("ALLOW_PRIVATE_MODEL_ENDPOINTS", "true")
    await runAppEffect(Effect.flatMap(Config, (config) => config.invalidate))
    await runAppEffect(
      saveIntegrationProvider(organizationId, { baseUrl: "http://127.0.0.1:11434/v1" }),
    )
    vi.unstubAllEnvs()
    await runAppEffect(Effect.flatMap(Config, (config) => config.invalidate))
  })

  test("requires the key again when a connection moves to another URL or provider type", async () => {
    const id = await runAppEffect(saveIntegrationProvider(organizationId))
    for (const change of [
      { baseUrl: "https://elsewhere.example/v1" },
      { providerType: "anthropic" as const, api: "anthropic-messages" as const },
    ]) {
      const refused = await runAppEffect(
        saveIntegrationProvider(organizationId, {
          id,
          lockVersion: 0,
          apiKey: null,
          ...change,
        }).pipe(Effect.flip),
      )
      expect(refused._tag).toBe("ModelProviderKeyMissing")
    }
  })

  test("deletes an unassigned provider even when its encrypted key is unreadable", async () => {
    const id = await runAppEffect(saveIntegrationProvider(organizationId))
    await db.execute(
      sql`update model_provider set credentials = 'corrupt', updated_at = now() where organization_id = ${organizationId} and id = ${id}`,
    )
    await runAppEffect(
      Effect.flatMap(ModelProviders, (service) =>
        service.remove({ organizationId, id, lockVersion: 0 }),
      ),
    )
    expect(
      await db.select().from(modelProvider).where(eq(modelProvider.organizationId, organizationId)),
    ).toEqual([])
  })

  test("reports setup readiness from the default agent's assignments only", async () => {
    const providerId = await runAppEffect(saveIntegrationProvider(organizationId))
    const provider = await runAppEffect(
      Effect.flatMap(ModelProviders, (service) => service.get({ organizationId, id: providerId })),
    )
    const [defaultAgent] = await db
      .insert(agent)
      .values({ organizationId, name: "Default", systemPrompt: "Help" })
      .returning()
    await db
      .insert(organizationConfiguration)
      .values({ organizationId, defaultAgentId: defaultAgent!.id })
    await db
      .insert(agentModel)
      .values({ organizationId, agentId, providerModelId: provider!.models[0]!.id, position: 0 })
    const setup = () =>
      runAppEffect(
        Effect.flatMap(ModelProviders, (service) => service.setupState({ organizationId })),
      )
    expect(await setup()).toMatchObject({
      defaultAgentId: formatAgentId({ organizationId, id: defaultAgent!.id }),
      defaultAgentModelCount: 0,
    })
    await db.insert(agentModel).values({
      organizationId,
      agentId: defaultAgent!.id,
      providerModelId: provider!.models[0]!.id,
      position: 0,
    })
    expect((await setup()).defaultAgentModelCount).toBe(1)
    await db
      .update(organizationConfiguration)
      .set({ defaultAgentId: null })
      .where(eq(organizationConfiguration.organizationId, organizationId))
    expect(await setup()).toMatchObject({ defaultAgentId: null, defaultAgentModelCount: 0 })
  })

  test("replaces ordered agent assignments atomically and makes the first model the default", async () => {
    const providerId = await runAppEffect(
      saveIntegrationProvider(organizationId, {
        models: [
          { modelId: "first", name: "First" },
          { modelId: "second", name: "Second" },
        ],
      }),
    )
    const provider = await runAppEffect(
      Effect.flatMap(ModelProviders, (service) => service.get({ organizationId, id: providerId })),
    )
    const modelIds = provider!.models.map((model) => model.id).reverse()
    await runAppEffect(
      Effect.flatMap(Agents, (service) =>
        service.update({
          organizationId,
          agentId: formatAgentId({ organizationId, id: agentId }),
          lockVersion: 0,
          fields: {
            name: "Assistant",
            systemPrompt: "Help",
            attachmentsEnabled: true,
            sandboxProviderId: null,
            modelIds,
          },
        }),
      ),
    )
    const configuration = await runAppEffect(
      Effect.flatMap(ModelProviders, (service) =>
        service.resolveForAgent({ organizationId, agentId }),
      ),
    )
    expect(configuration!.modelId).toBe("second")
    const edited = await runAppEffect(
      Effect.flatMap(Agents, (service) =>
        service.get({ organizationId, agentId: formatAgentId({ organizationId, id: agentId }) }),
      ),
    )
    expect(edited.modelIds).toEqual(modelIds)
  })
})
