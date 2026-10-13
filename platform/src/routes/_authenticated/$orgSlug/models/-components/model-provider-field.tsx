import type { ComponentProps, ReactNode } from "react"

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function ModelProviderField({
  id,
  label,
  value,
  onChange,
  errors,
  disabled,
  secret = false,
  placeholder,
  description,
  inputProps,
}: {
  id: string
  label: ReactNode
  value: string
  onChange: (value: string) => void
  errors: readonly { message: string }[]
  disabled: boolean
  secret?: boolean
  placeholder?: string | undefined
  description?: string
  inputProps?: Pick<ComponentProps<typeof Input>, "type" | "inputMode" | "min" | "step">
}) {
  return (
    <Field data-invalid={errors.length > 0 || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        type={secret ? "password" : "text"}
        {...inputProps}
        autoComplete={secret ? "new-password" : "off"}
        aria-invalid={errors.length > 0 || undefined}
        aria-describedby={`${id}-description ${id}-error`}
      />
      {description && <FieldDescription id={`${id}-description`}>{description}</FieldDescription>}
      <FieldError id={`${id}-error`} errors={[...errors]} />
    </Field>
  )
}
