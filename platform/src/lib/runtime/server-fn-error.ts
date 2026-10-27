/** Tag of every failure a server function does not expose, which the browser sees generically. */
export const INTERNAL_ERROR_TAG = "InternalError"

export interface ServerFnError {
  readonly tag: string
  readonly message: string
}

/** The reference an internal failure carries, which matches its one server log entry. */
export function serverFnErrorReference(error: unknown): string | undefined {
  const { tag, message } = parseServerFnError(error)
  return tag === INTERNAL_ERROR_TAG ? /Reference: ([0-9a-f]{8})$/.exec(message)?.[1] : undefined
}

// TanStack serializes only Error.message. Unrecognized errors stay internal.
// https://github.com/TanStack/router/blob/main/packages/router-core/src/ssr/serializer/ShallowErrorPlugin.ts
export function parseServerFnError(error: unknown): ServerFnError {
  const match = error instanceof Error ? /^\[([A-Z][A-Za-z]*)\] (.+)$/s.exec(error.message) : null
  return match
    ? { tag: match[1]!, message: match[2]! }
    : { tag: INTERNAL_ERROR_TAG, message: "The request failed. Try again." }
}
