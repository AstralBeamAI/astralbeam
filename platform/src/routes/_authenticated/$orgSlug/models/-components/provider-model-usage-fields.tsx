"use client"

import { Schema } from "effect"

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ProviderModelFields } from "@/lib/model-providers/schemas"
import {
  ModelUsageConfigurationSchema,
  modelInputAllowance,
  type ModelUsageConfiguration,
} from "@/lib/model-providers/usage-schemas"

const modelPricingFields = [
  ["inputPerMillion", "Input price"],
  ["outputPerMillion", "Output price"],
  ["cacheReadPerMillion", "Cache read price"],
  ["cacheWritePerMillion", "Cache write price"],
  ["cacheWrite1hPerMillion", "One-hour cache write price"],
] as const
const modelBoundFields = [
  ["maxInputTokens", "Input maximum"],
  ["contextWindowTokens", "Context window"],
  ["maxOutputTokens", "Model output maximum"],
  ["outputCap", "Output cap"],
] as const

export function ProviderModelUsageFields({
  model,
  disabled,
  catalogConfiguration,
  errors,
  onChange,
}: {
  model: ProviderModelFields
  disabled: boolean
  catalogConfiguration: ModelUsageConfiguration | null
  errors: (field: string) => readonly { message: string }[]
  onChange: (configuration: ModelUsageConfiguration | null) => void
}) {
  const overridden = model.usageConfiguration?.pricingSource.kind === "manual"
  const configuration: ModelUsageConfiguration = model.usageConfiguration ??
    catalogConfiguration ?? {
      currency: "USD",
      pricingSource: { kind: "manual" },
      prices: { inputPerMillion: "", outputPerMillion: "" },
      contextTiers: [],
      maxInputTokens: null,
      contextWindowTokens: null,
      maxOutputTokens: 4096,
      outputCap: 4096,
    }
  const valid = Schema.is(ModelUsageConfigurationSchema)(configuration)
  const overrideId = `model-${model.modelId}-override`
  const priceFields = modelPricingFields.map(([key, label]) => {
    const id = `model-${model.modelId}-${key}`
    const fieldErrors = errors(key)
    return (
      <Field key={key} data-invalid={fieldErrors.length > 0 || undefined}>
        <FieldLabel htmlFor={id}>
          {label}
          <span className="sr-only"> for {model.modelId}</span>
        </FieldLabel>
        <Input
          id={id}
          inputMode="decimal"
          value={configuration.prices[key] ?? ""}
          disabled={disabled}
          aria-invalid={fieldErrors.length > 0 || undefined}
          aria-describedby={`${id}-error`}
          placeholder={
            key === "inputPerMillion" || key === "outputPerMillion" ? "Required" : "Optional"
          }
          onChange={(event) => {
            const prices = { ...configuration.prices }
            if (!event.target.value && key !== "inputPerMillion" && key !== "outputPerMillion")
              delete prices[key]
            else prices[key] = event.target.value
            onChange({ ...configuration, prices })
          }}
        />
        <FieldError id={`${id}-error`} errors={[...fieldErrors]} />
      </Field>
    )
  })
  return (
    <div
      className="space-y-4 rounded-lg border p-4"
      role="group"
      aria-label={`Usage settings for ${model.modelId}`}
    >
      <p className="break-all text-sm font-medium">{model.modelId}</p>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor={overrideId}>
            Override catalog defaults<span className="sr-only"> for {model.modelId}</span>
          </FieldLabel>
          <FieldDescription id={`${overrideId}-description`}>
            {overridden
              ? "Your settings stay fixed. Turn off to discard overrides and restore automatic updates."
              : valid
                ? "Prices and token limits update automatically from the catalog."
                : "No catalog defaults are available. Turn on to configure this model manually."}
          </FieldDescription>
        </FieldContent>
        <Switch
          id={overrideId}
          aria-describedby={`${overrideId}-description`}
          checked={overridden}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange(
              checked
                ? { ...configuration, pricingSource: { kind: "manual" }, contextTiers: [] }
                : catalogConfiguration,
            )
          }
        />
      </Field>
      {overridden ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">{priceFields.slice(0, 2)}</div>
          <p className="text-sm font-medium">Token limits</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {modelBoundFields.map(([key, label]) => {
              const id = `model-${model.modelId}-${key}`
              const fieldErrors = errors(key)
              return (
                <Field key={key} data-invalid={fieldErrors.length > 0 || undefined}>
                  <FieldLabel htmlFor={id}>
                    {label}
                    <span className="sr-only"> for {model.modelId}</span>
                  </FieldLabel>
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    step={1}
                    value={configuration[key] ?? ""}
                    disabled={disabled}
                    aria-invalid={fieldErrors.length > 0 || undefined}
                    aria-describedby={`${id}-error`}
                    onChange={(event) =>
                      onChange({
                        ...configuration,
                        [key]: event.target.value
                          ? Number(event.target.value)
                          : key === "maxInputTokens" || key === "contextWindowTokens"
                            ? null
                            : 0,
                      })
                    }
                  />
                  <FieldError id={`${id}-error`} errors={[...fieldErrors]} />
                </Field>
              )
            })}
          </div>
          <FieldDescription>
            Set an input maximum or context window. Keep the output cap within the model output
            maximum. Verify the default 4,096-token output maximum with your provider before
            increasing it.
          </FieldDescription>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Cache pricing</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">{priceFields.slice(2)}</div>
          </details>
        </>
      ) : (
        valid && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {[
              ["Input price", `$${configuration.prices.inputPerMillion}`],
              ["Output price", `$${configuration.prices.outputPerMillion}`],
              ["Available input tokens", modelInputAllowance(configuration).toLocaleString()],
              ["Output cap (tokens)", configuration.outputCap.toLocaleString()],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )
      )}
      {valid && configuration.contextTiers.length > 0 && (
        <FieldDescription>
          {`Context pricing tiers: ${configuration.contextTiers.length}`}
        </FieldDescription>
      )}
    </div>
  )
}
