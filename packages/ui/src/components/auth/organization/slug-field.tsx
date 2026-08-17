// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/organization`
// Local edits: Uses Phosphor icons, accepts a typed organization client, normalizes and bounds slugs, blocks unavailable slugs through native form validation, and keeps the debounced availability check compatible with React Compiler.

"use client"

import {
  type OrganizationAuthClient,
  useAuth,
  useAuthPlugin,
  useCheckSlug,
} from "@better-auth-ui/react"
import { CheckIcon, XIcon } from "@phosphor-icons/react"
import { useDebouncer } from "@tanstack/react-pacer"
import { type ChangeEvent, type InvalidEvent, useEffect, useRef, useState } from "react"

import { Field, FieldError, FieldLabel } from "@/components/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/input-group"
import { Spinner } from "@/components/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import {
  ORGANIZATION_SLUG_MAX_LENGTH,
  ORGANIZATION_SLUG_MIN_LENGTH,
  sanitizeOrganizationSlug,
} from "@/lib/auth/organization-slug"

export type SlugFieldProps = {
  authClient: OrganizationAuthClient
  currentSlug?: string | undefined
  disabled?: boolean | undefined
  id?: string | undefined
  onChange: (value: string) => void
  value: string
}

const unavailableSlugMessage = "This organization URL is already in use."

/** Organization slug field with debounced availability checking. */
export function SlugField({
  authClient,
  currentSlug,
  disabled,
  id = "slug",
  onChange,
  value,
}: SlugFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { localization: authLocalization } = useAuth()
  const {
    localization,
    checkSlug: checkSlugEnabled,
    slugPrefix,
  } = useAuthPlugin(organizationPlugin)
  const [slugError, setSlugError] = useState<string>()
  const {
    mutate: checkSlug,
    data: checkSlugData,
    error: checkSlugError,
    reset: resetCheckSlug,
  } = useCheckSlug(authClient)
  const debouncer = useDebouncer(
    (next: string) => {
      if (!checkSlugEnabled || !next.trim() || next.trim() === currentSlug) {
        return
      }
      checkSlug({ slug: next.trim() })
    },
    { wait: 500 },
  )

  useEffect(() => {
    if (!checkSlugEnabled) return
    resetCheckSlug()
    debouncer.maybeExecute(value)
  }, [checkSlugEnabled, debouncer, resetCheckSlug, value])

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(sanitizeOrganizationSlug(event.target.value))
    setSlugError(undefined)
  }

  function handleInvalid(event: InvalidEvent<HTMLInputElement>) {
    event.preventDefault()
    setSlugError(
      event.currentTarget.validity.customError
        ? unavailableSlugMessage
        : authLocalization.auth.fieldRequired,
    )
  }

  const checkingSlug = checkSlugEnabled && !!value.trim() && value.trim() !== currentSlug
  const slugUnavailable = checkingSlug && checkSlugData?.status === false
  const validationError = slugError ?? (slugUnavailable ? unavailableSlugMessage : undefined)

  useEffect(() => {
    inputRef.current?.setCustomValidity(slugUnavailable ? unavailableSlugMessage : "")
  }, [slugUnavailable])

  return (
    <Field data-invalid={!!validationError}>
      <FieldLabel htmlFor={id}>{localization.slug}</FieldLabel>
      <InputGroup>
        {slugPrefix && <InputGroupAddon align="inline-start">{slugPrefix}</InputGroupAddon>}
        <InputGroupInput
          aria-invalid={!!validationError}
          disabled={disabled}
          id={id}
          maxLength={ORGANIZATION_SLUG_MAX_LENGTH}
          minLength={ORGANIZATION_SLUG_MIN_LENGTH}
          name="slug"
          onChange={handleChange}
          onInvalid={handleInvalid}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          placeholder={localization.slugPlaceholder}
          ref={inputRef}
          required
          value={value}
        />
        {checkingSlug && (
          <InputGroupAddon align="inline-end">
            {checkSlugData?.status === true ? (
              <CheckIcon className="size-4 text-foreground" />
            ) : slugUnavailable || checkSlugError ? (
              <XIcon className="size-4 text-destructive" />
            ) : (
              <Spinner />
            )}
          </InputGroupAddon>
        )}
      </InputGroup>
      <FieldError>{validationError}</FieldError>
    </Field>
  )
}
