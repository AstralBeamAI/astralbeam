import * as Schema from "effect/Schema"

export const SLUG_MAX_LENGTH = 63
const SLUG_PATTERN = /^[0-9a-z-]{1,63}$/
export const SLUG_VALIDATION_MESSAGE = "Slug must be 1–63 lowercase letters, numbers, or hyphens"

export const SlugSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(SLUG_PATTERN, { message: SLUG_VALIDATION_MESSAGE })),
)

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value)
}

/** Lowercases a name and joins its words with hyphens, blank when it has none. */
export function generateSlugSuggestion(source: string): string {
  const words = source.toLowerCase().match(/[0-9a-z]+/g) ?? []
  return words.join("-").slice(0, SLUG_MAX_LENGTH).replace(/-+$/, "")
}
