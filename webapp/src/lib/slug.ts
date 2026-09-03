export const SLUG_MAX_LENGTH = 63
export const SLUG_RANDOM_SUFFIX_LENGTH = 5
export const SLUG_PATTERN = /^[0-9a-z-]{1,63}$/
export const SLUG_VALIDATION_MESSAGE = "Slug must be 1–63 lowercase letters, numbers, or hyphens"

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value)
}

function sanitizeSlugSource(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-z]/g, "")
}

export function generateSlugSuggestion(
  source: string,
  fallback: string,
  suffixBytes?: Uint8Array,
): string {
  const baseMaximumLength = SLUG_MAX_LENGTH - SLUG_RANDOM_SUFFIX_LENGTH
  const sanitizedFallback = sanitizeSlugSource(fallback)
  const base = (sanitizeSlugSource(source) || sanitizedFallback || "item").slice(
    0,
    baseMaximumLength,
  )
  const randomBytes = suffixBytes ?? globalThis.crypto.getRandomValues(
    new Uint8Array(SLUG_RANDOM_SUFFIX_LENGTH),
  )
  if (randomBytes.length !== SLUG_RANDOM_SUFFIX_LENGTH) {
    throw new TypeError(`Slug suffix requires ${SLUG_RANDOM_SUFFIX_LENGTH} random bytes`)
  }
  const suffix = Array.from(randomBytes, (value) => (value % 36).toString(36)).join("")
  return `${base}${suffix}`
}
