import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export type SandboxTextFieldProps = {
  id: string
  label: string
  value: string
  maximumLength: number
  errors: Array<{ message: string }>
  disabled: boolean
  onChange: (value: string) => void
}

export function SandboxTextField({
  id,
  label,
  value,
  maximumLength,
  disabled,
  errors,
  onChange,
}: SandboxTextFieldProps) {
  return (
    <Field data-invalid={errors.length > 0 || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={errors.length > 0 || undefined}
        aria-describedby={errors.length > 0 ? `${id}-error` : undefined}
        value={value}
        maxLength={maximumLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={`${id}-error`} errors={errors} />
    </Field>
  )
}
