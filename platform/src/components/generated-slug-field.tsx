"use client"

import { CheckIcon, XIcon } from "@phosphor-icons/react"
import { useDebouncer } from "@tanstack/react-pacer"
import { useEffect, useState } from "react"

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import {
  generateSlugSuggestion,
  isValidSlug,
  SLUG_MAX_LENGTH,
  SLUG_VALIDATION_MESSAGE,
} from "@/lib/organizations/slug"

type SlugAvailability = "available" | "checking" | "idle" | "invalid" | "unavailable"
type SlugAvailabilityResult = {
  value: string
  availability: "available" | "idle" | "unavailable"
}

// HTML patterns use RegExp v-mode, which requires escaping hyphens in character classes.
// https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/pattern
const SLUG_INPUT_PATTERN = String.raw`[0-9a-z\-]{1,63}`

export type GeneratedSlugFieldProps = {
  id: string
  label: string
  sourceValue: string
  checkAvailability?: ((value: string) => Promise<boolean>) | undefined
  /** A value the server has since rejected as taken, overriding an earlier availability check. */
  unavailableValue?: string | undefined
  onAvailabilityChange?: ((availability: SlugAvailability) => void) | undefined
  formatPreview?: ((value: string) => string) | undefined
  disabled?: boolean | undefined
}

export function GeneratedSlugField({
  id,
  label,
  sourceValue,
  checkAvailability,
  unavailableValue,
  onAvailabilityChange,
  formatPreview,
  disabled,
}: GeneratedSlugFieldProps) {
  const [manualValue, setManualValue] = useState<string | null>(null)
  const [availabilityResult, setAvailabilityResult] = useState<SlugAvailabilityResult | null>(null)
  const value = manualValue ?? generateSlugSuggestion(sourceValue)
  const valid = isValidSlug(value)
  const availability: SlugAvailability = !valid
    ? "invalid"
    : value === unavailableValue
      ? "unavailable"
      : !checkAvailability
        ? "available"
        : availabilityResult?.value === value
          ? availabilityResult.availability
          : "checking"

  const availabilityDebouncer = useDebouncer(
    async (nextValue: string) => {
      if (!checkAvailability) return

      try {
        const next = (await checkAvailability(nextValue)) ? "available" : "unavailable"
        setAvailabilityResult({ value: nextValue, availability: next })
      } catch {
        setAvailabilityResult({ value: nextValue, availability: "idle" })
      }
    },
    { wait: 500 },
  )
  const { cancel: cancelAvailabilityCheck, maybeExecute: checkAvailabilityLater } =
    availabilityDebouncer

  useEffect(() => {
    onAvailabilityChange?.(availability)
    if (availability !== "checking" || !checkAvailability) {
      cancelAvailabilityCheck()
      return
    }

    checkAvailabilityLater(value)
    return cancelAvailabilityCheck
  }, [
    availability,
    cancelAvailabilityCheck,
    checkAvailabilityLater,
    checkAvailability,
    onAvailabilityChange,
    value,
  ])

  // A blank slug that follows a blank name is not an error until someone edits the field.
  const error =
    value.length === 0
      ? manualValue === null
        ? undefined
        : "Identifier is required"
      : !valid
        ? SLUG_VALIDATION_MESSAGE
        : availability === "unavailable"
          ? "This identifier is not available"
          : undefined

  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          name="slug"
          value={value}
          maxLength={SLUG_MAX_LENGTH}
          pattern={SLUG_INPUT_PATTERN}
          required
          disabled={disabled}
          aria-invalid={!!error}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setManualValue(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          {availability === "checking" && <Spinner />}
          {availability === "available" && <CheckIcon className="text-foreground" />}
          {availability === "unavailable" && <XIcon className="text-destructive" />}
        </InputGroupAddon>
      </InputGroup>
      <FieldDescription>
        {formatPreview && valid ? (
          <>
            Public ID: <span className="font-mono">{formatPreview(value)}</span>.
          </>
        ) : (
          "Use lowercase letters, numbers, and hyphens only."
        )}
      </FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  )
}
