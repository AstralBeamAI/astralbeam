import { useAuth } from "@better-auth-ui/react"
import { type ChangeEvent, type SyntheticEvent, useState } from "react"

type AuthField = "name" | "email" | "password" | "confirmPassword"

export function useAuthFieldErrors() {
  const { localization, emailAndPassword } = useAuth()
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AuthField, string | undefined>>>({})

  function fieldValidation({
    name,
    onChange,
  }: {
    name: AuthField
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
  }) {
    return {
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        onChange?.(event)
        setFieldErrors((previous) => ({ ...previous, [name]: undefined }))
      },
      onInvalid: (event: SyntheticEvent<HTMLInputElement>) => {
        event.preventDefault()
        const { validity } = event.currentTarget
        const message =
          validity.valueMissing || name === "name"
            ? localization.auth.fieldRequired
            : name === "email"
              ? localization.auth.invalidEmail
              : validity.tooShort
                ? localization.auth.tooShort.replace(
                    "{{min}}",
                    String(emailAndPassword?.minPasswordLength),
                  )
                : localization.auth.tooLong.replace(
                    "{{max}}",
                    String(emailAndPassword?.maxPasswordLength),
                  )
        setFieldErrors((previous) => ({ ...previous, [name]: message }))
      },
    }
  }

  return { fieldErrors, setFieldErrors, fieldValidation }
}
