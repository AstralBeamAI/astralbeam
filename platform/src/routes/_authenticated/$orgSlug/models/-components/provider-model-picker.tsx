"use client"

import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { Schema } from "effect"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { getModelUsageDefaults } from "../-functions/get-model-usage-defaults"
import {
  ProviderModelFieldsSchema,
  type ModelProviderType,
  type ProviderModelFields,
} from "@/lib/model-providers/schemas"

export function ProviderModelPicker({
  organizationSlug,
  providerType,
  catalog,
  models,
  disabled,
  onChange,
  errors,
}: {
  organizationSlug: string
  providerType: ModelProviderType
  catalog: readonly ProviderModelFields[]
  models: readonly ProviderModelFields[]
  disabled: boolean
  onChange: (models: ProviderModelFields[]) => void
  errors: readonly { message: string }[]
}) {
  const [search, setSearch] = useState("")
  const [customModelId, setCustomModelId] = useState("")
  const [customModels, setCustomModels] = useState<readonly ProviderModelFields[]>(models)
  const [customError, setCustomError] = useState<string | null>(null)
  const lookup = useMutation({
    mutationKey: ["model-usage-defaults", organizationSlug],
    mutationFn: async (model: ProviderModelFields): Promise<ProviderModelFields> =>
      models.find((item) => item.modelId === model.modelId) ??
      catalog.find((item) => item.modelId === model.modelId) ?? {
        ...model,
        usageConfiguration: await getModelUsageDefaults({
          data: { organizationSlug, providerType, modelId: model.modelId },
        }),
      },
  })
  const choices = [
    ...new Map(
      [...catalog, ...customModels, ...models].map((model) => [model.modelId, model]),
    ).values(),
  ]
  const filtered = choices.filter((model) =>
    model.modelId.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const addCustomModel = () => {
    const modelId = customModelId.trim()
    const model = {
      modelId,
      name: modelId.slice(0, 100),
    }
    if (!Schema.is(ProviderModelFieldsSchema)(model)) {
      setCustomError("Enter a model ID between 1 and 256 characters")
      return
    }
    lookup.mutate(model, {
      onSuccess: (selected) => {
        onChange([...models.filter((item) => item.modelId !== modelId), selected])
        setCustomModels((current) => [
          ...current.filter((item) => item.modelId !== modelId),
          selected,
        ])
        setCustomModelId("")
        setCustomError(null)
        setSearch("")
      },
      onError: (error) => setCustomError(parseServerFnError(error).message),
    })
  }
  return (
    <FieldSet aria-describedby="provider-models-description provider-models-error">
      <FieldLegend>Models</FieldLegend>
      <FieldDescription id="provider-models-description">
        Enable the models this connection can access. Catalog suggestions do not verify access.{" "}
        {models.length} selected.
      </FieldDescription>
      {choices.length > 0 && (
        <>
          <Field>
            <FieldLabel htmlFor="provider-model-search">Search models</FieldLabel>
            <Input
              id="provider-model-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={disabled}
              placeholder="Filter model IDs"
            />
          </Field>
          <FieldGroup className="max-h-64 overflow-y-auto rounded-lg border p-3">
            {filtered.map((choice) => {
              const modelId = choice.modelId
              const selected = models.some((model) => model.modelId === modelId)
              return (
                <Field key={modelId} orientation="horizontal">
                  <Checkbox
                    id={`provider-model-${modelId}`}
                    checked={selected}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      onChange(
                        checked
                          ? [...models, choice]
                          : models.filter((model) => model.modelId !== modelId),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`provider-model-${modelId}`} className="font-normal">
                    {modelId}
                  </FieldLabel>
                </Field>
              )
            })}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No matching models. Add a custom model below.
              </p>
            )}
          </FieldGroup>
        </>
      )}
      <Field data-invalid={customError !== null || undefined}>
        <FieldLabel htmlFor="custom-model-id">Custom model ID</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="custom-model-id"
            value={customModelId}
            disabled={disabled}
            maxLength={256}
            aria-invalid={customError !== null || undefined}
            aria-describedby="custom-model-id-error"
            placeholder="Model or deployment ID from your provider"
            onChange={(event) => {
              setCustomModelId(event.target.value)
              setCustomError(null)
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !customModelId.trim()}
            onClick={addCustomModel}
          >
            Add model
          </Button>
        </div>
        <FieldError id="custom-model-id-error">{customError}</FieldError>
      </Field>
      <FieldError id="provider-models-error" errors={[...errors]} />
    </FieldSet>
  )
}
