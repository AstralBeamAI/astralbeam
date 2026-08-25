"use client"

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
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { CopyValueButton } from "./copy-value-button"
import { SecretFieldInput } from "./secret-field-input"

const UNSET_OPTION = "__unset__"

export function ConfigFieldInput({
  field,
  draft,
  error,
  onDraftChange,
  onRotate,
  disabled,
}: {
  field: ConfigureField
  draft: FieldDraft
  error: string | undefined
  onDraftChange: (draft: FieldDraft) => void
  onRotate?: (() => void) | undefined
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
            value={currentValue === "" ? UNSET_OPTION : currentValue}
            onValueChange={(value) =>
              onDraftChange({ kind: "set", value: value === UNSET_OPTION ? "" : String(value) })}
          >
            <SelectTrigger id={`config-${field.key}`} disabled={disabled}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET_OPTION}>Not set</SelectItem>
              {(field.options ?? []).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
        : (
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
        )}
      <FieldDescription>{field.description}</FieldDescription>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}
