import { seedTarget } from "./worktree.ts"

/**
 * Signs chat tokens so a spec can exercise the chat endpoint's authorization directly, including
 * for a disabled key and another organization's key, which the app's own token route will never
 * mint.
 *
 * This deliberately reproduces `createAstralBeamChatToken` from `sdk/src/server/index.ts` rather
 * than calling it: `@astralbeam/sdk` reaches the example through a `file:` dependency, and Deno
 * refuses to import an npm package by `file:` specifier unless the whole project switches to a
 * manual node_modules directory. Keep this in step with that function, and note that
 * `preflight.setup.ts` compares a token minted here against one from the real route, while
 * `specs/app/auth.spec.ts` asserts a token signed here is *accepted* for an enabled key. A
 * signature that drifted out of step would fail those before it could make a rejection test pass
 * for the wrong reason.
 */

const ASTRALBEAM_CHAT_TOKEN_TYPE = "astralbeam+jwt"
const ASTRALBEAM_CHAT_TOKEN_VERSION = 4
const ASTRALBEAM_TOKEN_AUDIENCE = "astralbeam"
const ASTRALBEAM_CHAT_TOKEN_LIFETIME_SECONDS = 300

const textEncoder = new TextEncoder()

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function base64UrlFromJson(value: unknown): string {
  return base64UrlFromBytes(textEncoder.encode(JSON.stringify(value)))
}

function parseApiKey(apiKey: string): { keyId: string; organizationSlug: string; secret: string } {
  const separator = apiKey.lastIndexOf("_abo_")
  if (separator === -1) throw new Error("apiKey must match key_<organization>_<key>_abo_<secret>")
  const keyId = apiKey.slice(0, separator)
  return {
    keyId,
    organizationSlug: keyId.slice("key_".length, keyId.indexOf("_", "key_".length)),
    secret: apiKey.slice(separator + 1),
  }
}

/** Better Auth stores an unpadded base64url SHA-256 digest of the key, and that text is the HMAC secret. */
async function importSigningKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret))
  return await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(base64UrlFromBytes(new Uint8Array(digest))),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
}

export async function mintSeedChatToken(apiKey: string): Promise<string> {
  const { keyId, organizationSlug, secret } = parseApiKey(apiKey)
  const issuedAt = Math.floor(Date.now() / 1_000)
  const signingInput = [
    base64UrlFromJson({ alg: "HS256", typ: ASTRALBEAM_CHAT_TOKEN_TYPE, kid: keyId }),
    base64UrlFromJson({
      ver: ASTRALBEAM_CHAT_TOKEN_VERSION,
      user: seedTarget.user,
      tenant: seedTarget.tenant,
      iss: organizationSlug,
      aud: ASTRALBEAM_TOKEN_AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + ASTRALBEAM_CHAT_TOKEN_LIFETIME_SECONDS,
    }),
  ].join(".")
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importSigningKey(secret),
    textEncoder.encode(signingInput),
  )
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`
}

/** Reads a JWT's protected header without verifying it; the header names the signing API key. */
export function readJwtHeader(token: string): { kid?: string } {
  const [encodedHeader] = token.split(".")
  if (!encodedHeader) throw new Error("The token is not a JWT")
  const base64 = encodedHeader.replaceAll("-", "+").replaceAll("_", "/")
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as { kid?: string }
}
