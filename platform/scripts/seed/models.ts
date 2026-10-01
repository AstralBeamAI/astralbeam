import process from "node:process"

import { and, eq } from "drizzle-orm"

import {
  agent,
  agentModel,
  configTable,
  modelProvider,
  providerModel,
} from "../../src/db/schema.server.ts"
import { isValidOpenaiApiKey } from "../../src/lib/model-providers/schemas.ts"

import type { SeedTransaction } from "./database.ts"
import { SEED_MODEL_PROVIDER, SEED_ORGANIZATIONS } from "./fixtures.ts"

export async function seedModelProviders(
  transaction: SeedTransaction,
): Promise<"written" | "invalid" | "missing"> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return "missing"
  if (!isValidOpenaiApiKey(apiKey)) return "invalid"
  const [dogfood] = await transaction
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, "dogfood_organization_id"))
  if (dogfood?.value && dogfood.value.key !== "dogfood_organization_id") {
    throw new Error("Dogfood organization configuration has a mismatched identity")
  }
  const organizationIds = new Set<string>(SEED_ORGANIZATIONS.map(({ id }) => id))
  if (dogfood?.value?.value) organizationIds.add(dogfood.value.value)

  for (const organizationId of organizationIds) {
    const [existingProvider] = await transaction
      .select({ id: modelProvider.id })
      .from(modelProvider)
      .where(eq(modelProvider.organizationId, organizationId))
      .limit(1)
    // A configured organization owns its model choices, including intentionally disabled models.
    if (existingProvider) continue
    const [createdProvider] = await transaction
      .insert(modelProvider)
      .values({
        organizationId,
        name: SEED_MODEL_PROVIDER.name,
        providerType: "openai",
        api: "responses",
        baseUrl: "https://api.openai.com/v1",
      })
      .returning({ id: modelProvider.id })
    const modelProviderId = createdProvider!.id
    await transaction
      .update(modelProvider)
      .set({ credentials: { organizationId, modelProviderId, providerType: "openai", apiKey } })
      .where(
        and(
          eq(modelProvider.organizationId, organizationId),
          eq(modelProvider.id, modelProviderId),
        ),
      )
    const [createdModel] = await transaction
      .insert(providerModel)
      .values({
        organizationId,
        modelProviderId,
        modelId: SEED_MODEL_PROVIDER.modelId,
        name: SEED_MODEL_PROVIDER.modelName,
      })
      .returning({ id: providerModel.id })
    const assigned = await transaction
      .select({ agentId: agentModel.agentId })
      .from(agentModel)
      .where(eq(agentModel.organizationId, organizationId))
    const assignedIds = new Set(assigned.map(({ agentId }) => agentId))
    const agents = await transaction
      .select({ id: agent.id })
      .from(agent)
      .where(eq(agent.organizationId, organizationId))
    const assignments = agents
      .filter(({ id }) => !assignedIds.has(id))
      .map(({ id }) => ({
        organizationId,
        agentId: id,
        providerModelId: createdModel!.id,
        position: 0,
      }))
    if (assignments.length > 0) await transaction.insert(agentModel).values(assignments)
  }
  return "written"
}
