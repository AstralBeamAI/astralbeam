"use client"

import { useState } from "react"

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
import type { ProviderModelFields } from "@/lib/model-providers/schemas"

export function ProviderModelPicker({
  catalog,
  models,
  disabled,
  onChange,
  errors,
}: {
  catalog: readonly ProviderModelFields[]
  models: readonly ProviderModelFields[]
  disabled: boolean
  onChange: (models: ProviderModelFields[]) => void
  errors: readonly { message: string }[]
}) {
  const [search, setSearch] = useState("")
  const [previousSelections, setPreviousSelections] = useState<readonly ProviderModelFields[]>([])
  const choices = [
    ...new Map(
      [...catalog, ...previousSelections, ...models].map((model) => [model.modelId, model]),
    ).values(),
  ]
  const filtered = choices.filter((model) =>
    model.modelId.toLowerCase().includes(search.trim().toLowerCase()),
  )
  return (
    <FieldSet aria-describedby="provider-models-description provider-models-error">
      <FieldLegend>Models</FieldLegend>
      <FieldDescription id="provider-models-description">
        Choose models your API key can access. Test access after saving. {models.length} selected.
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
                    onCheckedChange={(checked) => {
                      if (!checked)
                        setPreviousSelections((current) => [
                          ...current.filter((model) => model.modelId !== modelId),
                          choice,
                        ])
                      onChange(
                        checked
                          ? [...models, choice]
                          : models.filter((model) => model.modelId !== modelId),
                      )
                    }}
                  />
                  <FieldLabel htmlFor={`provider-model-${modelId}`} className="font-normal">
                    {modelId}
                  </FieldLabel>
                </Field>
              )
            })}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground">No matching models.</p>
            )}
          </FieldGroup>
        </>
      )}
      <FieldError id="provider-models-error" errors={[...errors]} />
    </FieldSet>
  )
}
