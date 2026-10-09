import { captureMilestone } from "../../capture.ts"
import { expectToast } from "../../dialogs.ts"
import { expect, test } from "../../fixtures.ts"
import { waitForHydration } from "../../hydration.ts"
import { makeRunIdentity } from "../../identity.ts"

test("independent OpenAI connections supply distinct agent models and protect assignments", async ({
  page,
  baseline,
  models,
  agents,
}) => {
  test.setTimeout(120_000)
  const { runId } = makeRunIdentity()
  const primaryName = `OpenAI primary ${runId}`
  const secondaryName = `OpenAI secondary ${runId}`
  const upstreamModel = "gpt-6.1-sol"
  const firstChoice = `${upstreamModel} (${primaryName})`
  const secondChoice = `${upstreamModel} (${secondaryName})`
  const modelPath = `/${baseline.organizationSlug}/models`

  await test.step("save two OpenAI connections with the same upstream model", async () => {
    await page.goto(modelPath)
    await models.create({
      name: primaryName,
      modelId: upstreamModel,
      apiKey: "sk-browser-primary-1111",
      baseUrl: "https://primary.example.test/v1",
    })
    await page.goto(modelPath)
    await models.create({
      name: secondaryName,
      modelId: upstreamModel,
      apiKey: "sk-browser-secondary-2222",
      baseUrl: "https://secondary.example.test/v1",
    })
    await page.goto(modelPath)
    await expect(page.getByRole("link", { name: primaryName, exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: secondaryName, exact: true })).toBeVisible()
    await captureMilestone(page, "01-independent-provider-connections")
  })

  await test.step("a blank-key edit preserves credentials without returning them", async () => {
    await models.open(primaryName)
    await expect(page.getByLabel("API key", { exact: true })).toHaveValue("")
    await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute(
      "placeholder",
      "••••••••••••1111",
    )
    await expect(page.getByText("Stored key ends in 1111. Leave blank to keep it.")).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Provider", exact: true })).toBeDisabled()
    await page.getByLabel("API URL", { exact: true }).fill("https://moved.example.test/v1")
    await page.getByRole("button", { name: "Save provider", exact: true }).click()
    await expect(
      page.getByText("Enter the key again to use a new API URL", { exact: true }),
    ).toBeVisible()
    await page.getByLabel("API URL", { exact: true }).fill("https://primary.example.test/v1")
    await models.save()
    await page.reload()
    await waitForHydration(page.locator("#model-provider-name"))
    await expect(page.getByLabel("API key", { exact: true })).toHaveValue("")
    await expect(page.getByLabel("API URL", { exact: true })).toHaveValue(
      "https://primary.example.test/v1",
    )
    await expect(page.getByText("Stored key ends in 1111. Leave blank to keep it.")).toBeVisible()
  })

  await test.step("persist explicit zero pricing and reject an output cap above the maximum", async () => {
    await page.goto(modelPath)
    await models.open(primaryName)
    await page
      .getByRole("switch", { name: `Override catalog defaults for ${upstreamModel}`, exact: true })
      .check()
    await page.getByLabel(`Input price for ${upstreamModel}`, { exact: true }).fill("0")
    await page.getByLabel(`Output price for ${upstreamModel}`, { exact: true }).fill("0")
    await page.getByLabel(`Output cap for ${upstreamModel}`, { exact: true }).fill("4097")
    await page.getByRole("button", { name: "Save provider", exact: true }).click()
    await expect(
      page.getByText("Output cap exceeds the configured output maximum", { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByLabel(`Output cap for ${upstreamModel}`, { exact: true }),
    ).toHaveAttribute("aria-invalid", "true")
    await page.getByLabel(`Output cap for ${upstreamModel}`, { exact: true }).fill("1024")
    await models.save()
    await page.reload()
    await waitForHydration(page.locator("#model-provider-name"))
    await expect(page.getByLabel(`Input price for ${upstreamModel}`, { exact: true })).toHaveValue(
      "0",
    )
    await expect(page.getByLabel(`Output price for ${upstreamModel}`, { exact: true })).toHaveValue(
      "0",
    )
    await expect(page.getByLabel(`Output cap for ${upstreamModel}`, { exact: true })).toHaveValue(
      "1024",
    )
    await captureMilestone(page, "05-model-pricing-and-bounds")
  })

  await test.step("assign both connections and choose the second as default", async () => {
    await page.goto(`/${baseline.organizationSlug}/agents`)
    await agents.startCreate()
    await waitForHydration(page.locator("#agent-name"))
    await agents.fillForm({
      name: `Multi-provider agent ${runId}`,
      systemPrompt: "Help the user with their application.",
      models: [firstChoice, secondChoice],
    })
    await agents.selectDefaultModel(secondChoice)
    await agents.submitCreate()
    await page.reload()
    await expect(page.getByRole("checkbox", { name: firstChoice, exact: true })).toBeChecked()
    await expect(page.getByRole("checkbox", { name: secondChoice, exact: true })).toBeChecked()
    await expect(page.getByRole("combobox", { name: "Default model", exact: true })).toContainText(
      secondChoice,
    )
    await captureMilestone(page, "02-provider-qualified-agent-models")
  })

  await test.step("edit only explicit overrides and restore catalog defaults", async () => {
    await page.goto(modelPath)
    await page.getByRole("link", { name: "Add provider", exact: true }).first().click()
    await waitForHydration(page.locator("#model-provider-name"))
    await page.getByLabel("Name", { exact: true }).fill(`Catalog defaults ${runId}`)
    await page.getByLabel("API key", { exact: true }).fill("sk-catalog-browser-fixture")
    await page.getByRole("checkbox", { name: "gpt-6.1-sol", exact: true }).check()
    const override = page.getByRole("switch", {
      name: "Override catalog defaults for gpt-6.1-sol",
      exact: true,
    })
    const inputPrice = page.getByLabel("Input price for gpt-6.1-sol", { exact: true })
    const summary = page
      .getByRole("group", { name: "Usage settings for gpt-6.1-sol", exact: true })
      .locator("dl")
    await expect(override).toBeVisible()
    await expect(override).not.toBeChecked()
    await expect(inputPrice).toHaveCount(0)
    await override.check()
    await inputPrice.fill("7")
    await override.uncheck()
    await expect(summary).toContainText("$2")
    await expect(summary).toContainText("4,096")
    await expect(inputPrice).toHaveCount(0)
    await override.check()
    await inputPrice.fill("7")
    const modelChoice = page.getByRole("checkbox", { name: "gpt-6.1-sol", exact: true })
    await modelChoice.uncheck()
    await modelChoice.check()
    await expect(inputPrice).toHaveValue("7")
    await override.uncheck()
    await expect(summary).toContainText("$2")
    await override.check()
    await inputPrice.fill("7")
    await page.getByLabel("Output cap for gpt-6.1-sol", { exact: true }).fill("1024")
    await page.getByRole("button", { name: "Save provider", exact: true }).click()
    await expect(
      page.getByRole("heading", { level: 1, name: `Catalog defaults ${runId}`, exact: true }),
    ).toBeVisible()
    await page.reload()
    await waitForHydration(page.locator("#model-provider-name"))
    await expect(override).toBeChecked()
    await expect(inputPrice).toHaveValue("7")
    await expect(page.getByLabel("Output cap for gpt-6.1-sol", { exact: true })).toHaveValue("1024")
    await captureMilestone(page, "06-explicit-model-overrides")
    await override.uncheck()
    await modelChoice.uncheck()
    await modelChoice.check()
    await expect(override).not.toBeChecked()
    await expect(summary).toContainText("$2")
    await expect(inputPrice).toHaveCount(0)
    await models.save()
    await page.reload()
    await waitForHydration(page.locator("#model-provider-name"))
    await expect(override).not.toBeChecked()
    await expect(summary).toContainText("$2")
    await expect(summary).toContainText("4,096")
    await captureMilestone(page, "07-catalog-defaults-restored")
  })

  await test.step("prevent removal of a provider that the agent still uses", async () => {
    await page.goto(modelPath)
    await models.open(primaryName)
    await models.requestDelete()
    await expectToast(
      page,
      `Remove these models from the agent Multi-provider agent ${runId} before disabling them or deleting the provider`,
    )
    await expect(page.getByRole("heading", { level: 1, name: primaryName })).toBeVisible()
    await captureMilestone(page, "03-assigned-provider-protected")
  })

  await test.step("configure native Anthropic and OpenRouter with their endpoint defaults", async () => {
    await page.goto(modelPath)
    await models.create({
      name: `Anthropic ${runId}`,
      provider: "Anthropic",
      modelId: "claude-sonnet-5-5",
      apiKey: "sk-ant-browser-fixture-3333",
    })
    await expect(page.getByLabel("API URL", { exact: true })).toHaveValue(
      "https://api.anthropic.com",
    )
    await page.goto(modelPath)
    await models.create({
      name: `OpenRouter ${runId}`,
      provider: "OpenRouter",
      modelId: "anthropic/claude-sonnet-5.5",
      apiKey: "sk-or-browser-fixture-4444",
    })
    await expect(page.getByLabel("API URL", { exact: true })).toHaveValue(
      "https://openrouter.ai/api/v1",
    )
    await page.goto(modelPath)
    await expect(page.getByRole("link", { name: `Anthropic ${runId}`, exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: `OpenRouter ${runId}`, exact: true })).toBeVisible()
    await captureMilestone(page, "04-supported-provider-types")
  })
})
