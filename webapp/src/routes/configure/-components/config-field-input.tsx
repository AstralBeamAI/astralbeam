"use client"

import { Badge } from "@/components/ui/badge"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ConfigureField, FieldDraft } from "../-lib/types"
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
  const currentValue = draft.kind === "set"
    ? draft.value
    : draft.kind === "clear"
    ? ""
    : field.value ?? ""

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`config-${field.key}`}>
        {field.label}
        {field.required && <Badge variant="outline">Required</Badge>}
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
              onDraftChange(
                value === UNSET_OPTION ? { kind: "clear" } : { kind: "set", value: String(value) },
              )}
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
          <Input
            id={`config-${field.key}`}
            type={field.kind === "url" ? "url" : "text"}
            value={currentValue}
            disabled={disabled}
            onChange={(event) => onDraftChange({ kind: "set", value: event.target.value })}
          />
        )}
      <FieldDescription>{field.description}</FieldDescription>
      {field.isSet && field.updatedAt && (
        <p className="text-xs text-muted-foreground">
          Updated {new Date(field.updatedAt).toLocaleString()}
          {field.updatedBy ? ` by ${field.updatedBy}` : ""}
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}
