"use client"

import { useNavigate, useRouter } from "@tanstack/react-router"
import { useIsMutating } from "@tanstack/react-query"
import { type SyntheticEvent, useState } from "react"
import { Result, Schema, SchemaIssue } from "effect"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import type { OrganizationModelProvider } from "@/lib/model-providers/model-providers.server"
import {
  ModelProviderFieldsSchema,
  type ModelProviderApi,
  type ModelProviderType,
  type ProviderModelFields,
} from "@/lib/model-providers/schemas"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { strictParseOptions } from "@/lib/schemas"
import { saveModelProvider } from "../-functions/save-model-provider"
import { modelProviderApiItems, modelProviderDescriptors } from "../-lib/constants"
import { SaveModelProviderInputSchema } from "../-lib/schemas"
import { ModelProviderField } from "./model-provider-field"
import { ProviderModelPicker } from "./provider-model-picker"
import { ModelProviderTest } from "./model-provider-test"
import { ProviderModelUsageFields } from "./provider-model-usage-fields"
import { LocalDateTime } from "@/components/local-date-time"

const formatModelProviderIssues = SchemaIssue.makeFormatterStandardSchemaV1()
const equalModelProviderFields = Schema.toEquivalence(ModelProviderFieldsSchema)
const modelProviderTypeItems = [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "OpenRouter", value: "openrouter" },
]

export function ModelProviderForm({
  organizationSlug,
  provider: existing,
  catalog,
  pricingFetchedAt,
  pricingIsStale,
  readOnly,
}: {
  organizationSlug: string
  provider: OrganizationModelProvider | null
  catalog: Record<ModelProviderType, readonly ProviderModelFields[]>
  pricingFetchedAt: string | null
  pricingIsStale: boolean
  readOnly: boolean
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const lookingUpModel =
    useIsMutating({ mutationKey: ["model-usage-defaults", organizationSlug] }) > 0
  const testing = useIsMutating({ mutationKey: ["test-model-provider", existing?.id] }) > 0
  const [name, setName] = useState(existing?.name ?? "")
  const [providerType, setProviderType] = useState<ModelProviderType>(
    existing?.providerType ?? "openai",
  )
  const [api, setApi] = useState<ModelProviderApi>(existing?.api ?? "responses")
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? "https://api.openai.com/v1")
  const [apiKey, setApiKey] = useState("")
  const [models, setModels] = useState<ProviderModelFields[]>(
    existing?.models.map(({ modelId, name: modelName, usageConfiguration }) => ({
      modelId,
      name: modelName,
      usageConfiguration,
    })) ?? [],
  )
  const [catalogDefaults, setCatalogDefaults] = useState<readonly ProviderModelFields[]>(
    existing?.models.filter(
      (model) => model.usageConfiguration?.pricingSource.kind === "catalog",
    ) ?? [],
  )
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [serverFieldError, setServerFieldError] = useState<{
    field: string
    message: string
  } | null>(null)
  const input = Schema.decodeUnknownResult(
    SaveModelProviderInputSchema,
    strictParseOptions,
  )({
    organizationSlug,
    id: existing?.id ?? null,
    lockVersion: existing?.lockVersion ?? null,
    name: name.trim(),
    providerType,
    api,
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim() || null,
    models,
  })
  const issues = Result.isFailure(input)
    ? formatModelProviderIssues(input.failure.issue).issues
    : []
  // A stored key is reused only for the API URL it was saved with.
  const baseUrlChanged = existing !== null && baseUrl.trim() !== existing.baseUrl
  const missingKey =
    !apiKey.trim() && (!existing || !existing.credentialsReadable || baseUrlChanged)
  const fieldErrors = (field: string) => [
    ...(submitted
      ? issues.filter(
          (issue) =>
            issue.path?.[0] === field &&
            !(field === "models" && issue.path?.[2] === "usageConfiguration"),
        )
      : []),
    ...(submitted && field === "apiKey" && missingKey
      ? [
          {
            message: baseUrlChanged
              ? "Enter the key again to use a new API URL"
              : "Enter an API key",
          },
        ]
      : []),
    ...(serverFieldError?.field === field ? [{ message: serverFieldError.message }] : []),
  ]
  const disabled = saving || readOnly || testing || lookingUpModel
  const testDisabled =
    saving ||
    lookingUpModel ||
    existing === null ||
    Result.isFailure(input) ||
    !equalModelProviderFields(input.success, { ...existing, apiKey: null })
  const saveProvider = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (Result.isFailure(input) || missingKey || disabled) return
    setSaving(true)
    setServerFieldError(null)
    try {
      const modelProviderId = await saveModelProvider({ data: input.success })
      toast.add({ title: "Provider saved", type: "success" })
      if (existing) {
        await router.invalidate()
        return
      }
      await navigate({
        to: "/$orgSlug/models/$modelProviderId",
        params: { orgSlug: organizationSlug, modelProviderId },
        replace: true,
      })
    } catch (error) {
      const failure = parseServerFnError(error)
      if (failure.tag === "ModelProviderNameTaken")
        setServerFieldError({ field: "name", message: failure.message })
      else if (failure.tag === "ModelProviderEndpointNotAllowed")
        setServerFieldError({ field: "baseUrl", message: failure.message })
      else if (
        failure.tag === "ModelProviderKeyMissing" ||
        failure.tag === "ModelProviderUnreadable"
      )
        setServerFieldError({ field: "apiKey", message: failure.message })
      else if (failure.tag === "ModelUsageConfigurationMissing")
        setServerFieldError({ field: "models", message: failure.message })
      else toast.add({ title: failure.message, type: "error" })
      if (failure.tag === "ModelProviderChanged") await router.invalidate()
    } finally {
      setSaving(false)
    }
  }
  return (
    <form className="max-w-2xl space-y-6" onSubmit={(event) => void saveProvider(event)}>
      <Card>
        <CardHeader>
          <CardTitle>{existing ? "Configuration" : "Provider configuration"}</CardTitle>
          <CardDescription>
            Each provider has its own API key, API URL, and enabled models. You can add the same
            provider more than once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <ModelProviderField
              id="model-provider-name"
              label="Name"
              value={name}
              onChange={(value) => {
                setName(value)
                setServerFieldError(null)
              }}
              errors={fieldErrors("name")}
              disabled={disabled}
              description="A unique name for this connection, such as OpenAI production."
            />
            <Field>
              <FieldLabel htmlFor="model-provider-type">Provider</FieldLabel>
              <Select
                items={modelProviderTypeItems}
                value={providerType}
                disabled={disabled || existing !== null}
                onValueChange={(value) => {
                  if (!value) return
                  const next = value
                  setProviderType(next)
                  setApi(modelProviderDescriptors[next].api)
                  setBaseUrl(modelProviderDescriptors[next].baseUrl)
                  setModels([])
                  setCatalogDefaults([])
                }}
              >
                <SelectTrigger id="model-provider-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelProviderTypeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {existing && (
                <FieldDescription>
                  A connection keeps its provider. Add a new provider to switch.
                </FieldDescription>
              )}
            </Field>
            <ModelProviderField
              id="model-provider-url"
              label="API URL"
              value={baseUrl}
              onChange={(value) => {
                setBaseUrl(value)
                setServerFieldError(null)
              }}
              errors={fieldErrors("baseUrl")}
              disabled={disabled}
              description={
                providerType === "anthropic"
                  ? "The Anthropic API base URL. The Messages endpoint is added automatically."
                  : "The API base URL, including /v1 when required by your provider."
              }
            />
            {providerType === "openai" && (
              <Field>
                <FieldLabel htmlFor="model-provider-api">API format</FieldLabel>
                <Select
                  items={modelProviderApiItems}
                  value={api}
                  disabled={disabled}
                  onValueChange={(value) => {
                    if (value) setApi(value)
                  }}
                >
                  <SelectTrigger id="model-provider-api" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modelProviderApiItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Use the API format your endpoint supports.</FieldDescription>
              </Field>
            )}
            <ModelProviderField
              id="model-provider-key"
              label="API key"
              value={apiKey}
              onChange={(value) => {
                setApiKey(value)
                if (serverFieldError?.field === "apiKey") setServerFieldError(null)
              }}
              errors={fieldErrors("apiKey")}
              disabled={disabled}
              secret
              placeholder={
                existing?.credentialsReadable && existing.apiKeyHint && !baseUrlChanged
                  ? `${"•".repeat(12)}${existing.apiKeyHint}`
                  : undefined
              }
              description={
                existing?.credentialsReadable
                  ? baseUrlChanged
                    ? `Stored key ends in ${existing.apiKeyHint}. It applies only to the saved API URL.`
                    : `Stored key ends in ${existing.apiKeyHint}. Leave blank to keep it.`
                  : "Encrypted when saved. The stored key is never returned to your browser."
              }
            />
            {providerType === "openrouter" && (
              <FieldDescription>
                Use full OpenRouter model IDs, such as anthropic/claude-sonnet-4.6. OpenRouter
                handles provider routing through its Chat Completions API.
              </FieldDescription>
            )}
            <ProviderModelPicker
              key={providerType}
              organizationSlug={organizationSlug}
              providerType={providerType}
              catalog={catalog[providerType]}
              models={models}
              onChange={(next) => {
                setModels(next)
                setCatalogDefaults((current) => [
                  ...new Map(
                    [
                      ...current,
                      ...next.filter(
                        (model) => model.usageConfiguration?.pricingSource.kind === "catalog",
                      ),
                    ].map((model) => [model.modelId, model]),
                  ).values(),
                ])
              }}
              disabled={disabled}
              errors={fieldErrors("models")}
            />
            <FieldDescription>
              {pricingFetchedAt === null ? (
                "Using bundled catalog defaults. No successful refresh yet."
              ) : (
                <>
                  Catalog updated <LocalDateTime value={pricingFetchedAt} dateStyle="medium" />.
                </>
              )}
              {pricingIsStale &&
                " Automatic updates are delayed. Last known defaults remain available."}
            </FieldDescription>
            {models.map((model, index) => (
              <ProviderModelUsageFields
                key={model.modelId}
                model={model}
                catalogConfiguration={
                  catalog[providerType].find((item) => item.modelId === model.modelId)
                    ?.usageConfiguration ??
                  catalogDefaults.find((item) => item.modelId === model.modelId)
                    ?.usageConfiguration ??
                  null
                }
                disabled={disabled}
                errors={(field) =>
                  submitted
                    ? issues.filter(
                        (issue) =>
                          issue.path?.[0] === "models" &&
                          issue.path?.[1] === index &&
                          issue.path?.[2] === "usageConfiguration" &&
                          issue.path?.at(-1) === field,
                      )
                    : []
                }
                onChange={(usageConfiguration) =>
                  setModels((current) =>
                    current.map((item) =>
                      item.modelId === model.modelId ? { ...item, usageConfiguration } : item,
                    ),
                  )
                }
              />
            ))}
          </FieldGroup>
        </CardContent>
        {!readOnly && (
          <CardFooter>
            <Button type="submit" disabled={disabled}>
              {saving ? "Saving…" : "Save provider"}
            </Button>
          </CardFooter>
        )}
      </Card>
      {existing && !readOnly && (
        <ModelProviderTest
          organizationSlug={organizationSlug}
          provider={existing}
          disabled={testDisabled}
        />
      )}
    </form>
  )
}
