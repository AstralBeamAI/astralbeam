import { XIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { useIsHydrated } from "@/components/auth/use-is-hydrated"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldError } from "@/components/ui/field"
import { LocalDateTime } from "@/components/local-date-time"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ProviderModelFields } from "@/lib/model-providers/schemas"
import { ProviderField } from "../../-components/provider-field"
import { ModelPriceFields } from "./model-price-fields"

export function ModelPriceSchedule({
  model,
  disabled,
  errors,
  onChange,
}: {
  model: ProviderModelFields
  disabled: boolean
  errors: readonly { message: string }[]
  onChange: (prices: NonNullable<ProviderModelFields["scheduledPrices"]>) => void
}) {
  const schedule = model.scheduledPrices ?? []
  const hydrated = useIsHydrated()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [minimum] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60_000 + 60_000)
      .toISOString()
      .slice(0, 16),
  )
  return (
    <div className="space-y-3" role="group" aria-label={`Price schedule for ${model.modelId}`}>
      <p className="text-sm font-medium">Price schedule</p>
      <FieldDescription>
        Current price changes take effect when saved. Future prices use your time zone. Active
        versions cannot be edited or deleted.
      </FieldDescription>
      {schedule.map((version) => {
        const date = new Date(version.effectiveFrom)
        const value =
          !hydrated || Number.isNaN(date.getTime())
            ? ""
            : new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
                .toISOString()
                .slice(0, 16)
        return (
          <details
            key={version.id}
            open={expanded === version.id}
            onToggle={(event) => {
              const open = event.currentTarget.open
              setExpanded((current) =>
                open ? version.id : current === version.id ? null : current,
              )
            }}
            className="space-y-3 rounded-md border p-3"
          >
            <summary className="cursor-pointer text-sm">
              {version.effectiveFrom ? (
                <>
                  Scheduled · <LocalDateTime value={version.effectiveFrom} dateStyle="medium" />
                </>
              ) : (
                "New scheduled price"
              )}
            </summary>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <ProviderField
                  id={`price-${version.id}-date`}
                  label="Effective from"
                  value={value}
                  disabled={disabled}
                  errors={[]}
                  inputProps={{ type: "datetime-local", min: hydrated ? minimum : "" }}
                  onChange={(next) =>
                    onChange(
                      schedule.map((entry) =>
                        entry.id === version.id
                          ? { ...entry, effectiveFrom: next ? new Date(next).toISOString() : "" }
                          : entry,
                      ),
                    )
                  }
                />
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Cancel scheduled price"
                      disabled={disabled}
                      onClick={() => onChange(schedule.filter((entry) => entry.id !== version.id))}
                    />
                  }
                >
                  <XIcon />
                </TooltipTrigger>
                <TooltipContent>Cancel scheduled price</TooltipContent>
              </Tooltip>
            </div>
            <ModelPriceFields
              id={version.id}
              prices={version.rates!.prices}
              disabled={disabled}
              errors={() => []}
              onChange={(prices) =>
                onChange(
                  schedule.map((entry) =>
                    entry.id === version.id
                      ? { ...entry, rates: { ...entry.rates!, prices } }
                      : entry,
                  ),
                )
              }
            />
          </details>
        )
      })}
      <FieldError errors={[...errors]} />
      <Button
        type="button"
        variant="outline"
        disabled={disabled || schedule.length >= 32}
        onClick={() => {
          const id = crypto.randomUUID()
          setExpanded(id)
          onChange([
            ...schedule,
            {
              id,
              effectiveFrom: "",
              rates: {
                currency: "USD",
                pricingSource: { kind: "manual" },
                prices: { ...model.configuration!.prices },
                contextTiers: [],
              },
            },
          ])
        }}
      >
        Schedule price change
      </Button>
    </div>
  )
}
