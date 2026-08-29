"use client"

import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ConfigDefinition } from "@/lib/types"
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
  error,
  onDraftChange,
  onGenerate,
  footer,
  disabled,
}: {
  field: ConfigureField
  draft: FieldDraft
  error: string | undefined
  onDraftChange: (draft: FieldDraft) => void
  onGenerate?: (() => void) | undefined
  /** Rendered under a plain text or URL input, for actions only the editor knows how to offer. */
  footer?: ReactNode
  disabled: boolean
}) {
  const currentValue = draft.kind === "set" ? draft.value : field.value ?? ""
  const items = enumItems(field.options)

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`config-${field.key}`}>
        {field.label}
        {field.required && <Badge variant="outline">Required</Badge>}
        {field.isPublic && <Badge variant="secondary">Public</Badge>}
        <Badge variant={field.source === "environment" ? "secondary" : "outline"}>
          {field.source === "environment" ? "Environment" : "Database"}
        </Badge>
      </FieldLabel>
      {field.kind === "enum"
        ? (
          <Select
            // Base UI renders the raw value in the trigger unless it knows each option's label.
            // https://base-ui.com/react/components/select#value
            items={items}
            value={currentValue === "" ? UNSET_OPTION : currentValue}
            onValueChange={(value) =>
              onDraftChange({ kind: "set", value: value === UNSET_OPTION ? "" : String(value) })}
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
        )
        : (
          <ConfigValueInput
            field={field}
            draft={draft}
            onDraftChange={onDraftChange}
            onGenerate={onGenerate}
            footer={footer}
            disabled={disabled}
          />
        )}
      <FieldDescription>
        {field.description} {field.source === "environment"
          ? (
            <>
              Read-only value from <code>{field.environmentVariable}</code>.
            </>
          )
          : (
            <>
              Override with <code>{field.environmentVariable}</code>.
            </>
          )}
      </FieldDescription>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}
