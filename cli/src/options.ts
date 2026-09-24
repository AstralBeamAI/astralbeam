import { InvalidArgumentError } from "commander"

export function positiveInteger(value: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new InvalidArgumentError("Expected a positive integer.")
  }
  return number
}

/** A token lifetime, within the 60-600 seconds the API accepts. */
export function lifetimeSeconds(value: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 60 || number > 600) {
    throw new InvalidArgumentError("Expected a whole number of seconds from 60 to 600.")
  }
  return number
}

export function jsonObject(value: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new InvalidArgumentError("Expected a JSON object.")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InvalidArgumentError("Expected a JSON object.")
  }
  return parsed as Record<string, unknown>
}
