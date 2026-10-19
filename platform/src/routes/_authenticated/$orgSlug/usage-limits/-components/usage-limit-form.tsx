"use client"

import { useNavigate, useRouter } from "@tanstack/react-router"
import { useInvalidateOrganizationPages } from "../../-lib/page-query"
import { type SyntheticEvent, useMemo, useState } from "react"
import { Result, Schema, SchemaIssue } from "effect"

import { useIsHydrated } from "@/components/auth/use-is-hydrated"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import { parseServerFnError, type ServerFnError } from "@/lib/runtime/server-fn-error"
import { strictParseOptions } from "@/lib/schemas"
import { UsageLimitFieldsSchema, type UsageLimitFields } from "@/lib/usage-limits/schemas"
import type { UsageLimit } from "@/lib/usage-limits/usage-limits.server"
import { createUsageLimit } from "../-functions/create-usage-limit"
import { updateUsageLimit } from "../-functions/update-usage-limit"
import {
  usageLimitDurationItems,
  usageLimitMetricItems,
  usageLimitScopeItems,
  usageLimitWindowTypeItems,
  usageLimitWindowUnitItems,
} from "../-lib/constants"
import { summarizeUsageLimit, usageLimitDuration } from "../-lib/utils"

const formatUsageLimitIssues = SchemaIssue.makeFormatterStandardSchemaV1()
const decodeUsageLimitFields = Schema.decodeUnknownResult(
  UsageLimitFieldsSchema,
  strictParseOptions,
)

type Duration = (typeof usageLimitDurationItems)[number]["value"]

const usageLimitFieldLabels: Record<keyof UsageLimitFields, string> = {
  name: "Name",
  enabled: "Status",
  appliesByDefault: "Apply to every tenant user",
  scope: "Scope",
  metric: "Metric",
  amount: "Limit",
  windowType: "Window",
  windowCount: "Duration",
  windowUnit: "Duration",
  timeZone: "Time zone",
}

/** Base UI resolves the trigger's label from `items`, not from the rendered options. */
function UsageLimitSelect<Value extends string>({
  items,
  value,
  onChange,
  disabled,
  className,
  ...trigger
}: {
  items: readonly { value: Value; label: string }[]
  value: Value
  onChange: (value: Value) => void
  disabled: boolean
  className: string
  id?: string
  "aria-label"?: string
}) {
  return (
    <Select
      items={items.map((item) => ({ value: item.value, label: item.label }))}
      value={value}
      onValueChange={(next) => next && onChange(next)}
      disabled={disabled}
    >
      <SelectTrigger {...trigger} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The runtime's IANA zones, with UTC first because some engines omit it. */
function listTimeZones(): string[] {
  return ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")]
}

export function UsageLimitForm({
  organizationSlug,
  usageLimit: existing,
  readOnly,
}: {
  organizationSlug: string
  /** Null on the create page, where the limit's ID does not exist yet. */
  usageLimit: UsageLimit | null
  readOnly: boolean
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const invalidatePages = useInvalidateOrganizationPages()
  const [appliesByDefault, setAppliesByDefault] = useState(existing?.appliesByDefault ?? true)
  const [name, setName] = useState(existing?.name ?? "")
  const [scope, setScope] = useState<UsageLimitFields["scope"]>(existing?.scope ?? "tenant_user")
  const [duration, setDuration] = useState<Duration>(
    existing ? usageLimitDuration(existing) : "month",
  )
  const [customCount, setCustomCount] = useState(String(existing?.windowCount ?? 5))
  const [customUnit, setCustomUnit] = useState<UsageLimitFields["windowUnit"]>(
    existing?.windowUnit ?? "hour",
  )
  const [windowType, setWindowType] = useState<UsageLimitFields["windowType"]>(
    existing?.windowType ?? "fixed",
  )
  const [timeZoneChoice, setTimeZone] = useState(existing?.timeZone ?? null)
  const [metric, setMetric] = useState<UsageLimitFields["metric"]>(existing?.metric ?? "tokens")
  const [amount, setAmount] = useState(existing?.amount ?? "")
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saveError, setSaveError] = useState<ServerFnError | null>(null)
  const conflicted = saveError?.tag === "UsageLimitChanged"

  // Zone lists and the browser's zone differ from the server's, so they wait for hydration.
  const hydrated = useIsHydrated()
  const timeZone =
    timeZoneChoice ?? (hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC")
  const zoneList = useMemo(() => (hydrated ? listTimeZones() : []), [hydrated])
  const timeZones = zoneList.includes(timeZone) ? zoneList : [timeZone, ...zoneList]

  const global = scope === "global"
  const input = decodeUsageLimitFields({
    name: name.trim(),
    enabled: existing?.enabled ?? true,
    appliesByDefault: global || appliesByDefault,
    scope,
    metric,
    amount: amount.trim(),
    windowType,
    windowCount: duration === "custom" ? Number(customCount) : 1,
    windowUnit: duration === "custom" ? customUnit : duration,
    timeZone: windowType === "fixed" ? timeZone : null,
  })
  const issues = Result.isFailure(input) ? formatUsageLimitIssues(input.failure.issue).issues : []
  const summaryIssues = [
    ...new Set(
      issues.map((issue) => {
        const field = issue.path?.[0] as keyof UsageLimitFields
        return `${usageLimitFieldLabels[field] ?? "Configuration"}: ${issue.message}`
      }),
    ),
  ]
  const fieldErrors = (field: string) =>
    submitted ? issues.filter((issue) => issue.path?.[0] === field) : []
  const disabled = saving || readOnly

  const saveUsageLimit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (Result.isFailure(input) || disabled || conflicted) return
    setSaving(true)
    setSaveError(null)
    try {
      if (existing) {
        await updateUsageLimit({
          data: {
            organizationSlug,
            usageLimitId: existing.id,
            lockVersion: existing.lockVersion,
            fields: input.success,
          },
        })
        toast.add({ title: "Usage limit saved", type: "success" })
        await invalidatePages()
        await router.invalidate()
        return
      }
      const usageLimitId = await createUsageLimit({
        data: { organizationSlug, fields: input.success },
      })
      toast.add({ title: "Usage limit created", type: "success" })
      await invalidatePages()
      await navigate({
        to: "/$orgSlug/usage-limits/$usageLimitId",
        params: { orgSlug: organizationSlug, usageLimitId },
        replace: true,
      })
    } catch (error) {
      const failure = parseServerFnError(error)
      setSaveError(failure)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void saveUsageLimit(event)} className="max-w-2xl" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{existing ? "Configuration" : "New usage limit"}</CardTitle>
          <CardDescription>
            Chat requests are refused once usage reaches the limit, until its window resets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <Checkbox
                id="usage-limit-applies-by-default"
                checked={global || appliesByDefault}
                disabled={disabled || global}
                onCheckedChange={(next) => setAppliesByDefault(next === true)}
              />
              <FieldContent>
                <FieldLabel htmlFor="usage-limit-applies-by-default">
                  Apply to every tenant user
                </FieldLabel>
                <FieldDescription>
                  {global
                    ? "Global limits always apply to everyone."
                    : "Otherwise the limit applies only to chat tokens that list its ID."}
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field data-invalid={fieldErrors("name").length > 0 || undefined}>
              <FieldLabel htmlFor="usage-limit-name">Name</FieldLabel>
              <Input
                id="usage-limit-name"
                value={name}
                maxLength={100}
                placeholder="Weekly limit"
                disabled={disabled}
                aria-invalid={fieldErrors("name").length > 0 || undefined}
                aria-describedby="usage-limit-name-error"
                onChange={(event) => setName(event.target.value)}
              />
              <FieldError id="usage-limit-name-error" errors={fieldErrors("name")} />
              <FieldDescription>Shown to tenant users when they reach this limit.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="usage-limit-scope">Scope</FieldLabel>
              <UsageLimitSelect
                items={usageLimitScopeItems}
                value={scope}
                onChange={setScope}
                disabled={disabled}
                id="usage-limit-scope"
                className="w-full"
              />
              <FieldDescription>
                {usageLimitScopeItems.find((item) => item.value === scope)?.description}
              </FieldDescription>
            </Field>

            <Field data-invalid={fieldErrors("windowCount").length > 0 || undefined}>
              <FieldLabel htmlFor="usage-limit-duration">Duration</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <UsageLimitSelect
                  items={usageLimitDurationItems}
                  value={duration}
                  onChange={setDuration}
                  disabled={disabled}
                  id="usage-limit-duration"
                  className="w-36"
                />
                {duration === "custom" && (
                  <>
                    <Input
                      aria-label="Number of units"
                      type="number"
                      min={1}
                      step={1}
                      className="w-24"
                      value={customCount}
                      disabled={disabled}
                      aria-invalid={fieldErrors("windowCount").length > 0 || undefined}
                      aria-describedby="usage-limit-window-count-error"
                      onChange={(event) => setCustomCount(event.target.value)}
                    />
                    <UsageLimitSelect
                      items={usageLimitWindowUnitItems}
                      value={customUnit}
                      onChange={setCustomUnit}
                      disabled={disabled}
                      aria-label="Unit"
                      className="w-32"
                    />
                  </>
                )}
              </div>
              <FieldError id="usage-limit-window-count-error" errors={fieldErrors("windowCount")} />
            </Field>

            <Field>
              <FieldLabel htmlFor="usage-limit-window-type">Window</FieldLabel>
              <UsageLimitSelect
                items={usageLimitWindowTypeItems}
                value={windowType}
                onChange={setWindowType}
                disabled={disabled}
                id="usage-limit-window-type"
                className="w-36"
              />
              <FieldDescription>
                {usageLimitWindowTypeItems.find((item) => item.value === windowType)?.description}
              </FieldDescription>
            </Field>

            {windowType === "fixed" && (
              <Field data-invalid={fieldErrors("timeZone").length > 0 || undefined}>
                <FieldLabel htmlFor="usage-limit-time-zone">Time zone</FieldLabel>
                <NativeSelect
                  id="usage-limit-time-zone"
                  className="w-full"
                  value={timeZone}
                  disabled={disabled}
                  aria-invalid={fieldErrors("timeZone").length > 0 || undefined}
                  aria-describedby="usage-limit-time-zone-error"
                  onChange={(event) => setTimeZone(event.target.value)}
                >
                  {timeZones.map((zone) => (
                    <NativeSelectOption key={zone} value={zone}>
                      {zone.replaceAll("_", " ")}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldError id="usage-limit-time-zone-error" errors={fieldErrors("timeZone")} />
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="usage-limit-metric">Metric</FieldLabel>
              <UsageLimitSelect
                items={usageLimitMetricItems}
                value={metric}
                onChange={setMetric}
                disabled={disabled}
                id="usage-limit-metric"
                className="w-36"
              />
              <FieldDescription>
                {metric === "tokens"
                  ? "Input and output tokens, including cached input."
                  : "Model cost at each model's configured price."}
              </FieldDescription>
            </Field>

            <Field data-invalid={fieldErrors("amount").length > 0 || undefined}>
              <FieldLabel htmlFor="usage-limit-amount">Limit</FieldLabel>
              <InputGroup className="w-56">
                {metric === "spend" && (
                  <InputGroupAddon>
                    <InputGroupText>$</InputGroupText>
                  </InputGroupAddon>
                )}
                <InputGroupInput
                  id="usage-limit-amount"
                  inputMode={metric === "tokens" ? "numeric" : "decimal"}
                  placeholder={metric === "tokens" ? "1000000" : "25.00"}
                  value={amount}
                  disabled={disabled}
                  aria-invalid={fieldErrors("amount").length > 0 || undefined}
                  aria-describedby="usage-limit-amount-error"
                  onChange={(event) => setAmount(event.target.value)}
                />
                {metric === "tokens" && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>tokens</InputGroupText>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <FieldError id="usage-limit-amount-error" errors={fieldErrors("amount")} />
            </Field>
          </FieldGroup>
          <div className="mt-6 border-t pt-4 text-sm" role="status">
            <p className="font-medium">Limit summary</p>
            {Result.isSuccess(input) ? (
              <p className="mt-1 text-muted-foreground">{summarizeUsageLimit(input.success)}</p>
            ) : (
              <ul className="mt-1 list-disc space-y-1 ps-4 text-muted-foreground">
                {summaryIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
          {saveError && (
            <Alert variant="destructive" className="mt-6">
              <AlertTitle>Could not save usage limit</AlertTitle>
              <AlertDescription>
                <p>{saveError.message}</p>
                {conflicted && (
                  <p>Reloading replaces your unsaved edits with the latest saved version.</p>
                )}
              </AlertDescription>
              {conflicted && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 w-fit"
                  onClick={() => void router.invalidate()}
                >
                  Reload latest
                </Button>
              )}
            </Alert>
          )}
        </CardContent>
        {!readOnly && (
          <CardFooter className="justify-end gap-2">
            <Button type="submit" disabled={saving || conflicted}>
              {saving ? "Saving…" : existing ? "Save changes" : "Create limit"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}
