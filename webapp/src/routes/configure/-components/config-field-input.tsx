"use client"

import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ConfigOption } from "@/lib/types"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { CopyValueButton } from "./copy-value-button"
import { SecretFieldInput } from "./secret-field-input"

const UNSET_OPTION = "__unset__"

// The unset choice leads so both the trigger label and the popup list come from one source.
function enumItems(options: readonly ConfigOption[] | undefined): ConfigOption[] {
  return [{ value: UNSET_OPTION, label: "Not set" }, ...(options ?? [])]
}

export function ConfigFieldInput({
  field,
  draft,
  error,
  onDraftChange,
  onRotate,
  footer,
  disabled,
}: {
  field: ConfigureField
  draft: FieldDraft
  error: string | undefined
  onDraftChange: (draft: FieldDraft) => void
  onRotate?: (() => void) | undefined
  /** Rendered under a plain text or URL input, for actions only the editor knows how to offer. */
  footer?: ReactNode
  disabled: boolean
}) {
  const currentValue = draft.kind === "set" ? draft.value : field.value ?? ""

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`config-${field.key}`}>
        {field.label}
        {field.required && <Badge variant="outline">Required</Badge>}
        {field.isPublic && <Badge variant="secondary">Public</Badge>}
      </FieldLabel>
      {field.secret
        ? (
          <SecretFieldInput
            field={field}
            draft={draft}
            onDraftChange={onDraftChange}
            onRotate={onRotate}
            disabled={disabled}
          />
        )
        : field.kind === "enum"
        ? (
          <Select
            // Base UI renders the raw value in the trigger unless it knows each option's label.
            // https://base-ui.com/react/components/select#value
            items={enumItems(field.options)}
            value={currentValue === "" ? UNSET_OPTION : currentValue}
            onValueChange={(value) =>
              onDraftChange({ kind: "set", value: value === UNSET_OPTION ? "" : String(value) })}
          >
            <SelectTrigger id={`config-${field.key}`} disabled={disabled}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {enumItems(field.options).map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
        : (
          <div className="flex flex-col gap-2">
            <InputGroup>
              <InputGroupInput
                id={`config-${field.key}`}
                type={field.kind === "url" ? "url" : "text"}
                value={currentValue}
                placeholder="Not set"
                disabled={disabled}
                onChange={(event) => onDraftChange({ kind: "set", value: event.target.value })}
              />
              <InputGroupAddon align="inline-end">
                <CopyValueButton value={currentValue} label={field.label} />
              </InputGroupAddon>
            </InputGroup>
            {footer}
          </div>
        )}
      <FieldDescription>{field.description}</FieldDescription>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}
