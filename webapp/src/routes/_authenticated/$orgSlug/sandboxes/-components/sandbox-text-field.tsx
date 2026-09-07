import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export type SandboxTextFieldProps = {
  id: string
  label: string
  value: string
  maximumLength: number
  disabled: boolean
  onChange: (value: string) => void
}

export function SandboxTextField({
  id,
  label,
  value,
  maximumLength,
  disabled,
  onChange,
}: SandboxTextFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        maxLength={maximumLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}
