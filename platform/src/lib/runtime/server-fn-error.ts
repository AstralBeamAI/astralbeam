/** Tag of every failure a server function does not expose, which the browser sees generically. */
export const INTERNAL_ERROR_TAG = "InternalError"

export interface ServerFnError {
  readonly tag: string
  readonly message: string
}

// TanStack Start serializes only `Error.message`, so the tag travels inside it.
// https://github.com/TanStack/router/blob/main/packages/router-core/src/ssr/serializer/ShallowErrorPlugin.ts
const SERVER_FN_ERROR_PATTERN = /^\[([A-Z][A-Za-z]*)\] (.+)$/s

export function formatServerFnError(error: ServerFnError): string {
  return `[${error.tag}] ${error.message}`
}

const REFERENCE_PATTERN = /Reference: ([0-9a-f]{8})$/

/** The reference an internal failure carries, which matches its one server log entry. */
export function serverFnErrorReference(error: unknown): string | undefined {
  const { tag, message } = parseServerFnError(error)
  return tag === INTERNAL_ERROR_TAG ? REFERENCE_PATTERN.exec(message)?.[1] : undefined
}

/** Reads a thrown server function error, treating anything unrecognized as internal. */
export function parseServerFnError(error: unknown): ServerFnError {
  const match = error instanceof Error ? SERVER_FN_ERROR_PATTERN.exec(error.message) : null
  return match
    ? { tag: match[1]!, message: match[2]! }
    : { tag: INTERNAL_ERROR_TAG, message: "The request failed. Try again." }
}
