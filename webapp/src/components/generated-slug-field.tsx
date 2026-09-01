"use client"

import { ArrowsClockwiseIcon, CheckIcon, XIcon } from "@phosphor-icons/react"
import { useDebouncer } from "@tanstack/react-pacer"
import { useEffect, useState } from "react"

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import {
  generateSlugSuggestion,
  isValidSlug,
  SLUG_MAX_LENGTH,
  SLUG_RANDOM_SUFFIX_LENGTH,
} from "@/lib/slug"

type SlugAvailability = "available" | "checking" | "idle" | "invalid" | "unavailable"
type SlugAvailabilityResult = {
  value: string
  availability: "available" | "idle" | "unavailable"
}

export type GeneratedSlugFieldProps = {
  id: string
  label: string
  sourceValue: string
  fallback: string
  checkAvailability?: ((value: string) => Promise<boolean>) | undefined
  onAvailabilityChange?: ((availability: SlugAvailability) => void) | undefined
  formatPreview?: ((value: string) => string) | undefined
  createSuffixBytes?: (() => Uint8Array) | undefined
  disabled?: boolean | undefined
}

export function GeneratedSlugField({
  id,
  label,
  sourceValue,
  fallback,
  checkAvailability,
  onAvailabilityChange,
  formatPreview,
  createSuffixBytes = createSlugSuffixBytes,
  disabled,
}: GeneratedSlugFieldProps) {
  const [suffixBytes, setSuffixBytes] = useState<Uint8Array | null>(null)
  const [manualValue, setManualValue] = useState<string | null>(null)
  const [availabilityResult, setAvailabilityResult] = useState<SlugAvailabilityResult | null>(null)
  const suggestion = suffixBytes === null
    ? ""
    : generateSlugSuggestion(sourceValue, fallback, suffixBytes)
  const value = manualValue ?? suggestion
  const valid = isValidSlug(value)
  const availability: SlugAvailability = !valid
    ? "invalid"
    : !checkAvailability
    ? "available"
    : availabilityResult?.value === value
    ? availabilityResult.availability
    : "checking"

  const availabilityDebouncer = useDebouncer(
    async (nextValue: string) => {
      if (!checkAvailability) return

      try {
        const next = await checkAvailability(nextValue) ? "available" : "unavailable"
        setAvailabilityResult({ value: nextValue, availability: next })
      } catch {
        setAvailabilityResult({ value: nextValue, availability: "idle" })
      }
    },
    { wait: 500 },
  )
  const { cancel: cancelAvailabilityCheck, maybeExecute: checkAvailabilityLater } =
    availabilityDebouncer

  // Generate browser-only randomness after hydration so the initial trees match.
  // https://react.dev/reference/react-dom/client/hydrateRoot#caveats
  useEffect(() => {
    const timeout = globalThis.setTimeout(() => {
      setSuffixBytes((current) => current ?? createSuffixBytes())
    })
    return () => globalThis.clearTimeout(timeout)
  }, [createSuffixBytes])

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

  const regenerate = () => {
    setSuffixBytes(createSuffixBytes())
    setManualValue(null)
  }

  const error = suffixBytes === null
    ? undefined
    : value.length === 0
    ? "Identifier is required"
    : !valid
    ? "Use 1–63 lowercase letters and numbers"
    : availability === "unavailable"
    ? "This identifier is already in use"
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
          pattern="[0-9a-z]{1,63}"
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
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label="Generate another identifier"
            title="Generate another identifier"
            disabled={disabled}
            onClick={regenerate}
          >
            <ArrowsClockwiseIcon aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FieldDescription>
        {formatPreview && valid
          ? (
            <>
              Public ID: <span className="font-mono">{formatPreview(value)}</span>
            </>
          )
          : (
            `Generated suggestions use lowercase letters and numbers followed by a random ${SLUG_RANDOM_SUFFIX_LENGTH}-character suffix.`
          )}
      </FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  )
}

function createSlugSuffixBytes(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(SLUG_RANDOM_SUFFIX_LENGTH))
}
