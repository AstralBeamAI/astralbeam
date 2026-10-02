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
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  errors: readonly { message: string }[]
  disabled: boolean
  secret?: boolean
  placeholder?: string | undefined
  description?: string
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
        autoComplete={secret ? "new-password" : "off"}
        aria-invalid={errors.length > 0 || undefined}
        aria-describedby={`${id}-description ${id}-error`}
      />
      {description && <FieldDescription id={`${id}-description`}>{description}</FieldDescription>}
      <FieldError id={`${id}-error`} errors={[...errors]} />
    </Field>
  )
}
