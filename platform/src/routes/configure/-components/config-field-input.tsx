"use client"

import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ConfigDefinition } from "@/lib/config/types"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { ConfigValueInput } from "./config-value-input"

const UNSET_OPTION = "__unset__"

// Enum settings currently have runtime defaults, so clearing one restores that default.
function enumItems(
  options: ConfigDefinition["options"],
): NonNullable<ConfigDefinition["options"]>[number][] {
  return [{ value: UNSET_OPTION, label: "Use default" }, ...(options ?? [])]
}

export function ConfigFieldInput({
  field,
  draft,
  revealedValue,
  error,
  onDraftChange,
  onGenerate,
  onReveal,
  footer,
  disabled,
}: {
  field: ConfigureField
  draft: FieldDraft
  revealedValue?: string | undefined
  error: string | undefined
  onDraftChange: (draft: FieldDraft) => void
  onGenerate?: (() => void) | undefined
  onReveal?: (() => Promise<boolean>) | undefined
  /** Rendered under a plain text or URL input, for actions only the editor knows how to offer. */
  footer?: ReactNode
  disabled: boolean
}) {
  const currentValue = draft.kind === "set" ? draft.value : (field.value ?? "")
  const items = enumItems(field.options)
  const trustProxy = currentValue !== "" && currentValue !== "false"

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`config-${field.key}`}>
        {field.key === "trust_proxy" && (
          <Checkbox
            id={`config-${field.key}`}
            checked={trustProxy}
            disabled={disabled || field.source === "environment"}
            onCheckedChange={(checked) =>
              onDraftChange({ kind: "set", value: checked ? "true" : "false" })
            }
          />
        )}
        {field.label}
        {field.required && <Badge variant="outline">Required</Badge>}
        {field.isPublic && <Badge variant="secondary">Public</Badge>}
        {field.source === "environment" && <Badge variant="secondary">Environment</Badge>}
      </FieldLabel>
      {field.key === "trust_proxy" ? (
        trustProxy && (
          <div className="mt-2 flex flex-col gap-2">
            <FieldLabel htmlFor="config-trust-proxy-addresses">
              Additional proxy IPs/CIDRs (optional)
            </FieldLabel>
            <Input
              id="config-trust-proxy-addresses"
              value={currentValue === "true" ? "" : currentValue}
              placeholder="Leave empty to trust all proxies"
              disabled={disabled || field.source === "environment"}
              onChange={(event) =>
                onDraftChange({ kind: "set", value: event.target.value.trim() || "true" })
              }
            />
          </div>
        )
      ) : field.kind === "enum" ? (
        <Select
          // Base UI renders the raw value in the trigger unless it knows each option's label.
          // https://base-ui.com/react/components/select#value
          items={items}
          value={currentValue === "" ? UNSET_OPTION : currentValue}
          onValueChange={(value) =>
            onDraftChange({ kind: "set", value: value === UNSET_OPTION ? "" : String(value) })
          }
        >
          <SelectTrigger
            id={`config-${field.key}`}
            disabled={disabled || field.source === "environment"}
          >
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
      ) : (
        <ConfigValueInput
          field={field}
          draft={draft}
          revealedValue={revealedValue}
          onDraftChange={onDraftChange}
          onGenerate={onGenerate}
          onReveal={onReveal}
          footer={footer}
          disabled={disabled}
        />
      )}
      <FieldDescription>
        {field.description}{" "}
        {field.source === "environment" ? (
          <>
            Read-only value from <code>{field.environmentVariable}</code>.
          </>
        ) : (
          <>
            Override with <code>{field.environmentVariable}</code>.
          </>
        )}
      </FieldDescription>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}
