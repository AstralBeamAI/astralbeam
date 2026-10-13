import { randomBytes } from "node:crypto"
import { Effect, Schema } from "effect"
import { Config } from "@/lib/config/config"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import {
  McpApplicationOriginSchema,
  McpAttemptReferenceSchema,
  type McpAttemptReference,
} from "../schemas.ts"
import { McpAuthorization, mcpAttemptLocator } from "./authorization.ts"
import { mcpClientMetadata } from "./provider.ts"

const mcpBrowserCookieSchema = Schema.Struct({ challenge: Schema.String, origin: Schema.String })
function mcpPopupHtml(script: string, cookie?: string): Response {
  const nonce = randomBytes(24).toString("base64url")
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Connect account</title></head><body><p id="status">Connecting your account…</p><script nonce="${nonce}">${script}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
        ...(cookie ? { "Set-Cookie": cookie } : {}),
      },
    },
  )
}
function mcpPopupJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}
function mcpBrowserCookie(request: Request, reference: McpAttemptReference) {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`mcp_oauth_${reference.id}=`))
    ?.split("=")[1]
  if (!value) return null
  try {
    return Schema.decodeUnknownSync(mcpBrowserCookieSchema)(
      JSON.parse(Buffer.from(value, "base64url").toString()),
    )
  } catch {
    return null
  }
}
function mcpPopupReference(url: URL) {
  try {
    return Schema.decodeUnknownSync(McpAttemptReferenceSchema)(
      JSON.parse(Buffer.from(url.searchParams.get("attempt") ?? "", "base64url").toString()),
    )
  } catch {
    return null
  }
}

export const handleMcpBrowserRequest = Effect.gen(function* () {
  const { request } = yield* ServerRequest
  const url = new URL(request.url)
  const config = yield* Config
  const baseUrl = yield* config.get("app_base_url")
  if (!baseUrl) return new Response("Application configuration required", { status: 503 })
  const authority = yield* McpAuthorization
  if (url.pathname.endsWith("/client-metadata.json"))
    return Response.json(mcpClientMetadata(baseUrl), {
      headers: { "Cache-Control": "public, max-age=300" },
    })
  if (url.pathname.endsWith("/connect")) {
    const reference = mcpPopupReference(url)
    const origin = url.searchParams.get("origin")
    if (!reference || !Schema.is(McpApplicationOriginSchema)(origin))
      return new Response("Invalid authorization request", { status: 400 })
    const challenge = randomBytes(32).toString("base64url")
    const secure = new URL(baseUrl).protocol === "https:" ? "; Secure" : ""
    const cookie = `mcp_oauth_${reference.id}=${Buffer.from(JSON.stringify({ challenge, origin })).toString("base64url")}; Path=/api/mcp/oauth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`
    const next = new URL("/api/mcp/oauth/continue", baseUrl)
    next.searchParams.set("attempt", url.searchParams.get("attempt")!)
    return mcpPopupHtml(
      `const attempt=${mcpPopupJson(reference)},origin=${mcpPopupJson(origin)},challenge=${mcpPopupJson(challenge)}; if(!window.opener){document.getElementById('status').textContent='Open this connection from the application.'}else{window.opener.postMessage({type:'mcp-browser-challenge',attempt,challenge},origin);const timer=setInterval(async()=>{try{const response=await fetch(${mcpPopupJson(next.href)},{credentials:'same-origin'});if(response.ok){const result=await response.json();clearInterval(timer);location.replace(result.url)}}catch{}},500);setTimeout(()=>{clearInterval(timer);document.getElementById('status').textContent='Authorization expired. Close this window and try again.'},600000)}`,
      cookie,
    )
  }
  if (url.pathname.endsWith("/continue")) {
    const reference = mcpPopupReference(url)
    const cookie = reference && mcpBrowserCookie(request, reference)
    if (!reference || !cookie) return new Response("Authorization required", { status: 403 })
    return yield* authority
      .browserRedirect({ reference, browserBinding: cookie.challenge, origin: cookie.origin })
      .pipe(
        Effect.map((destination) =>
          Response.json({ url: destination }, { headers: { "Cache-Control": "no-store" } }),
        ),
        Effect.catch(() => Effect.succeed(new Response("Authorization pending", { status: 409 }))),
      )
  }
  if (url.pathname.endsWith("/callback")) {
    const reference = mcpAttemptLocator(url.searchParams.get("state") ?? "")
    const cookie = reference && mcpBrowserCookie(request, reference)
    if (!reference || !cookie)
      return new Response("Authorization browser did not match", { status: 403 })
    return yield* authority
      .callback({
        params: url.searchParams,
        browserBinding: cookie.challenge,
        origin: cookie.origin,
      })
      .pipe(
        Effect.map((attempt) =>
          mcpPopupHtml(
            `document.getElementById('status').textContent='Account authorized. Return to the application to finish connecting.';if(window.opener)window.opener.postMessage({type:'mcp-authorization-result',attempt:${mcpPopupJson(attempt)},status:'awaiting_completion'},${mcpPopupJson(cookie.origin)});`,
            `mcp_oauth_${reference.id}=; Path=/api/mcp/oauth; HttpOnly; SameSite=Lax; Max-Age=0${new URL(baseUrl).protocol === "https:" ? "; Secure" : ""}`,
          ),
        ),
        Effect.catch(() =>
          Effect.succeed(
            mcpPopupHtml(
              `document.getElementById('status').textContent='Authorization failed. Close this window and try again.';if(window.opener)window.opener.postMessage({type:'mcp-authorization-result',attempt:${mcpPopupJson(reference)},status:'failed'},${mcpPopupJson(cookie.origin)});`,
            ),
          ),
        ),
      )
  }
  return new Response("Not found", { status: 404 })
})
