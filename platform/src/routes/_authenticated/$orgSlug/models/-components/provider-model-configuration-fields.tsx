"use client"

import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import {
  modelInputAllowance,
  type ModelConfiguration,
  type ProviderModelFields,
} from "@/lib/model-providers/schemas"
import { ProviderField } from "../../-components/provider-field"
import { ModelPriceFields } from "./model-price-fields"
import { ModelPriceSchedule } from "./model-price-schedule"

const modelBoundFields = [
  ["maxInputTokens", "Input maximum"],
  ["contextWindowTokens", "Context window"],
  ["maxOutputTokens", "Model output maximum"],
  ["outputCap", "Output cap"],
] as const

export function ProviderModelConfigurationFields({
  model,
  disabled,
  catalogConfiguration,
  errors,
  onChange,
  onScheduleChange,
  scheduleErrors,
}: {
  model: ProviderModelFields
  disabled: boolean
  catalogConfiguration: ModelConfiguration | null
  errors: (field: string) => readonly { message: string }[]
  onChange: (configuration: ModelConfiguration | null) => void
  onScheduleChange: (scheduledPrices: NonNullable<ProviderModelFields["scheduledPrices"]>) => void
  scheduleErrors: readonly { message: string }[]
}) {
  const overridden = model.configuration?.pricingSource.kind === "manual"
  const configuration: ModelConfiguration = model.configuration ??
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
  const hasCatalogDefaults = catalogConfiguration !== null
  const overrideId = `model-${model.modelId}-override`
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
            {overridden && !hasCatalogDefaults
              ? "Your settings stay fixed. Catalog defaults are unavailable for this model."
              : overridden
                ? "Turn off to restore automatic updates and cancel scheduled prices."
                : hasCatalogDefaults
                  ? "Base prices shown below. Cache and long-context rates also apply where available. Catalog defaults update automatically."
                  : "No catalog defaults are available. Turn on to configure this model manually."}
          </FieldDescription>
        </FieldContent>
        <Switch
          id={overrideId}
          aria-describedby={`${overrideId}-description`}
          checked={overridden}
          disabled={disabled || (overridden && !hasCatalogDefaults)}
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
          <ModelPriceFields
            id={model.modelId}
            prices={configuration.prices}
            disabled={disabled}
            errors={errors}
            onChange={(prices) => onChange({ ...configuration, prices })}
          />
          <p className="text-sm font-medium">Token limits</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {modelBoundFields.map(([key, label]) => (
              <ProviderField
                key={key}
                id={`model-${model.modelId}-${key}`}
                label={
                  <>
                    {label}
                    <span className="sr-only"> for {model.modelId}</span>
                  </>
                }
                inputProps={{ type: "number", min: 1, step: 1 }}
                value={String(configuration[key] ?? "")}
                disabled={disabled}
                errors={errors(key)}
                onChange={(value) =>
                  onChange({
                    ...configuration,
                    [key]: value
                      ? Number(value)
                      : key === "maxInputTokens" || key === "contextWindowTokens"
                        ? null
                        : 0,
                  })
                }
              />
            ))}
          </div>
          <FieldDescription>
            Set an input maximum or context window. Keep the output cap within the model output
            maximum. Verify the default 4,096-token output maximum with your provider before
            increasing it.
          </FieldDescription>
          <ModelPriceSchedule
            model={model}
            disabled={disabled}
            errors={scheduleErrors}
            onChange={onScheduleChange}
          />
        </>
      ) : (
        hasCatalogDefaults && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {[
              ["Input price", `$${configuration.prices.inputPerMillion}`],
              ["Output price", `$${configuration.prices.outputPerMillion}`],
              [
                "Available input tokens",
                modelInputAllowance(configuration).toLocaleString("en-US"),
              ],
              ["Output cap (tokens)", configuration.outputCap.toLocaleString("en-US")],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )
      )}
    </div>
  )
}
