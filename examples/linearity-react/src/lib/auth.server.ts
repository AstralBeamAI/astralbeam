import { createHash, timingSafeEqual } from "node:crypto"

export function basicAuth(
  request: Request,
  username: string | undefined,
  password: string | undefined,
): Response | undefined {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" }
  if (!username || !password || username.includes(":"))
    return new Response("Set BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD on the server.", {
      status: 503,
      headers,
    })
  const authorization = request.headers.get("authorization") ?? ""
  let actual = ""
  try {
    const [scheme, encoded] = authorization.split(" ")
    if (scheme?.toLowerCase() === "basic" && encoded)
      actual = new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
      )
  } catch {
    actual = ""
  }
  const digest = (value: string) => createHash("sha256").update(value).digest()
  if (timingSafeEqual(digest(actual), digest(`${username}:${password}`))) return undefined
  return new Response("Sign in to the Linearity playground.", {
    status: 401,
    headers: {
      ...headers,
      "WWW-Authenticate": 'Basic realm="Linearity playground", charset="UTF-8"',
    },
  })
}
