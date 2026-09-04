const GRAVATAR_AVATAR_SIZE = "128"

/** Build the canonical Gravatar image URL for a normalized email address. */
export async function getGravatarAvatarUrl(email: string): Promise<string | undefined> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return undefined

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizedEmail),
  )
  const hash = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")
  const url = new URL(`https://gravatar.com/avatar/${hash}`)
  url.searchParams.set("d", "404")
  url.searchParams.set("r", "g")
  url.searchParams.set("s", GRAVATAR_AVATAR_SIZE)
  return url.toString()
}
