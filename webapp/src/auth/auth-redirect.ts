const AUTH_REDIRECT_ORIGIN = "https://astralbeam.invalid"

export function normalizeAuthRedirect(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined

  try {
    const target = new URL(value, AUTH_REDIRECT_ORIGIN)
    if (target.origin !== AUTH_REDIRECT_ORIGIN || target.pathname.startsWith("//")) return undefined

    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return undefined
  }
}
