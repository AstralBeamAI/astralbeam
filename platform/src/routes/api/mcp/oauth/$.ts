import { createFileRoute } from "@tanstack/react-router"
import { runRouteEffect } from "@/lib/runtime/server-fn.server"
import { randomBytes } from "node:crypto"
import { Effect, Schema } from "effect"
import { Config } from "@/lib/config/config"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { McpApplicationOriginSchema } from "@/lib/mcp/schemas"
import { McpAuthorization, mcpAttemptLocator } from "@/lib/mcp/authorization.server"
import { mcpClientMetadata } from "@/lib/mcp/provider.server"

const mcpBrowserCookieSchema = Schema.Struct({ challenge: Schema.String, origin: Schema.String })
function mcpPopupHtml(script: string, cookie?: string): Response {
  const nonce = randomBytes(24).toString("base64url")
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Authorize MCP connection</title></head><body><p id="status">Authorizing connection…</p><script nonce="${nonce}">${script}</script></body></html>`,
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
function mcpBrowserCookie(value: string | undefined) {
  if (!value) return null
  try {
    return Schema.decodeUnknownSync(mcpBrowserCookieSchema)(
      JSON.parse(Buffer.from(value, "base64url").toString()),
    )
  } catch {
    return null
  }
}
const handleMcpBrowserRequest = Effect.gen(function* () {
  const { request, cookie: getCookie } = yield* ServerRequest
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
    const reference = mcpAttemptLocator(url.searchParams.get("attempt") ?? "")
    const origin = url.searchParams.get("origin")
    if (!reference || !Schema.is(McpApplicationOriginSchema)(origin))
      return new Response("Invalid authorization request", { status: 400 })
    const challenge = randomBytes(32).toString("base64url")
    const secure = new URL(baseUrl).protocol === "https:" ? "; Secure" : ""
    const cookie = `mcp_oauth_${reference.connectionId}=${Buffer.from(JSON.stringify({ challenge, origin })).toString("base64url")}; Path=/api/mcp/oauth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`
    const next = new URL("/api/mcp/oauth/continue", baseUrl)
    next.searchParams.set("attempt", url.searchParams.get("attempt")!)
    return mcpPopupHtml(
      `const attempt=${mcpPopupJson(reference)},origin=${mcpPopupJson(origin)},challenge=${mcpPopupJson(challenge)}; if(!window.opener){document.getElementById('status').textContent='Open this connection from the application.'}else{window.opener.postMessage({type:'mcp-browser-challenge',attempt,challenge},origin);const timer=setInterval(async()=>{try{const response=await fetch(${mcpPopupJson(next.href)},{credentials:'same-origin'});if(response.ok){const result=await response.json();clearInterval(timer);window.opener=null;location.replace(result.url)}else if(response.status!==409&&response.status<500){clearInterval(timer);document.getElementById('status').textContent='Authorization ended. Close this window and try again.'}}catch{}},500);setTimeout(()=>{clearInterval(timer);document.getElementById('status').textContent='Authorization expired. Close this window and try again.'},600000)}`,
      cookie,
    )
  }
  if (url.pathname.endsWith("/continue")) {
    const reference = mcpAttemptLocator(url.searchParams.get("attempt") ?? "")
    const cookie = reference && mcpBrowserCookie(getCookie(`mcp_oauth_${reference.connectionId}`))
    if (!reference || !cookie) return new Response("Authorization required", { status: 403 })
    return yield* authority
      .browserRedirect({ reference, browserBinding: cookie.challenge, origin: cookie.origin })
      .pipe(
        Effect.map((destination) =>
          destination
            ? Response.json({ url: destination }, { headers: { "Cache-Control": "no-store" } })
            : new Response("Authorization pending", { status: 409 }),
        ),
        Effect.catch(() => Effect.succeed(new Response("Authorization ended", { status: 403 }))),
      )
  }
  if (url.pathname.endsWith("/callback")) {
    const reference = mcpAttemptLocator(url.searchParams.get("state") ?? "")
    const cookie = reference && mcpBrowserCookie(getCookie(`mcp_oauth_${reference.connectionId}`))
    if (!reference || !cookie)
      return new Response("Authorization browser did not match", { status: 403 })
    return yield* authority
      .callback({
        params: url.searchParams,
        browserBinding: cookie.challenge,
        origin: cookie.origin,
      })
      .pipe(
        Effect.map(() =>
          mcpPopupHtml(
            `document.getElementById('status').textContent='Connection authorized. Return to the application to finish connecting.';`,
            `mcp_oauth_${reference.connectionId}=; Path=/api/mcp/oauth; HttpOnly; SameSite=Lax; Max-Age=0${new URL(baseUrl).protocol === "https:" ? "; Secure" : ""}`,
          ),
        ),
        Effect.catch(() =>
          Effect.succeed(
            mcpPopupHtml(
              `document.getElementById('status').textContent='Authorization failed. Close this window and try again.';`,
            ),
          ),
        ),
      )
  }
  return new Response("Not found", { status: 404 })
})

export const Route = createFileRoute("/api/mcp/oauth/$")({
  server: { handlers: { GET: () => runRouteEffect(handleMcpBrowserRequest) } },
})
