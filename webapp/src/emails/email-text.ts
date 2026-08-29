const emailTextGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Truncate user-visible email text without splitting emoji or combined Unicode characters. */
export function truncateEmailGraphemes(value: string, limit: number): string {
  return Array.from(emailTextGraphemeSegmenter.segment(value), ({ segment }) => segment)
    .slice(0, limit)
    .join("")
}
