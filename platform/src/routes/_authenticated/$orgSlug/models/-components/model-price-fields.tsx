import type { ModelConfiguration } from "@/lib/model-providers/schemas"
import { ProviderField } from "../../-components/provider-field"

const modelPriceFields = [
  ["inputPerMillion", "Input price"],
  ["outputPerMillion", "Output price"],
  ["cacheReadPerMillion", "Cache read price"],
  ["cacheWritePerMillion", "Cache write price"],
  ["cacheWrite1hPerMillion", "One-hour cache write price"],
] as const

export function ModelPriceFields({
  id,
  prices,
  disabled,
  errors,
  onChange,
}: {
  id: string
  prices: ModelConfiguration["prices"]
  disabled: boolean
  errors: (field: string) => readonly { message: string }[]
  onChange: (prices: ModelConfiguration["prices"]) => void
}) {
  const fields = modelPriceFields.map(([key, label]) => (
    <ProviderField
      key={key}
      id={`${id}-${key}`}
      label={
        <>
          {label}
          <span className="sr-only"> for {id}</span>
        </>
      }
      inputProps={{ inputMode: "decimal" }}
      value={prices[key] ?? ""}
      disabled={disabled}
      errors={errors(key)}
      placeholder={
        key === "inputPerMillion" || key === "outputPerMillion" ? "Required" : "Optional"
      }
      onChange={(value) => {
        const next = { ...prices }
        if (!value && key !== "inputPerMillion" && key !== "outputPerMillion") delete next[key]
        else next[key] = value
        onChange(next)
      }}
    />
  ))
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">{fields.slice(0, 2)}</div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Cache pricing</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{fields.slice(2)}</div>
      </details>
    </>
  )
}
