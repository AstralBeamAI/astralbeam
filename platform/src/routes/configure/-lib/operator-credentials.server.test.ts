import { createServerEntry, getResponseHeaders } from "@tanstack/react-start/server"
import { Effect } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"

import { captureServerRequest, ServerRequest } from "@/lib/runtime/server-request.server"
import { isTrustedProxyAddress, proxySettingsFromValues } from "@/lib/utils.server"
import { checkConfigureRequest, isSameOriginConfigureRequest } from "./configure-request.server"
import { clearOperatorSessionCookie, setOperatorSessionCookie } from "./operator-session.server"

function serveConfigureBoundary(
  request: Request,
  effect: Effect.Effect<void, { readonly _tag: string }, ServerRequest> = checkConfigureRequest(),
) {
  return createServerEntry({
    fetch: async () => {
      const outcome = await Effect.runPromise(
        effect.pipe(
          Effect.provideService(ServerRequest, {
            ...captureServerRequest(),
            clientAddress: "172.18.0.1",
          }),
          Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "ok" }),
        ),
      )
      return new Response(outcome, { headers: [...getResponseHeaders()] })
    },
  }).fetch(request)
}

afterEach(() => vi.unstubAllEnvs())

describe("operator request boundary", () => {
  test("trusts loopback peers by default to forward host and protocol", () => {
    const proxy = proxySettingsFromValues({})
    expect(isTrustedProxyAddress("127.0.0.1", proxy)).toBe(true)
    expect(isTrustedProxyAddress("::1", proxy)).toBe(true)
    expect(isTrustedProxyAddress("::ffff:127.0.0.1", proxy)).toBe(true)
    expect(isTrustedProxyAddress("203.0.113.7", proxy)).toBe(false)
    expect(isTrustedProxyAddress("127.0.0.1.example", proxy)).toBe(false)
    expect(isTrustedProxyAddress(undefined, proxy)).toBe(false)
  })

  test.each<[string, HeadersInit, boolean]>([
    ["GET", {}, true],
    ["POST", { origin: "https://app.example", "sec-fetch-site": "same-origin" }, true],
    ["POST", { origin: "https://app.example" }, false],
  ])(
    "accepts safe methods and only same-origin browser mutations (%s)",
    (method, headers, allowed) => {
      vi.stubEnv("ALLOW_INSECURE", "")
      expect(
        isSameOriginConfigureRequest(
          new Request("http://internal:3000/_server", { method, headers }),
          new URL("https://app.example/configure"),
        ),
      ).toBe(allowed)
    },
  )

  test.each<[string, string, HeadersInit, string]>([
    ["", "GET", { "x-forwarded-proto": "https" }, "ServerRedirect"],
    ["false", "POST", {}, "ConfigureHttpsRequired"],
    ["true", "GET", {}, "ok"],
    ["true", "POST", { origin: "http://app.example" }, "ok"],
    ["true", "POST", { referer: "http://app.example/configure" }, "ok"],
    ["true", "POST", { origin: "http://attacker.example" }, "ConfigureRequestForbidden"],
    [
      "true",
      "POST",
      { origin: "http://app.example", "sec-fetch-site": "cross-site" },
      "ConfigureRequestForbidden",
    ],
    ["true", "POST", {}, "ConfigureRequestForbidden"],
  ])(
    "requires an explicit HTTP opt-in and same-origin mutations (%s %s)",
    async (flag, method, headers, expected) => {
      vi.stubEnv("PROD", true)
      vi.stubEnv("ALLOW_INSECURE", flag)
      const response = await serveConfigureBoundary(
        new Request("http://app.example/configure", { method, headers }),
      )
      expect(await response.text()).toBe(expected)
    },
  )

  test.each<[boolean, string | undefined, boolean]>([
    [false, undefined, false],
    [true, undefined, true],
    [true, "true", false],
  ])(
    "keeps cookie issue and clearing security consistent (PROD=%s, ALLOW_INSECURE=%s)",
    async (production, flag, secure) => {
      vi.stubEnv("PROD", production)
      vi.stubEnv("ALLOW_INSECURE", flag)
      for (const effect of [setOperatorSessionCookie("token"), clearOperatorSessionCookie()]) {
        const response = await serveConfigureBoundary(
          new Request("http://app.example/configure"),
          effect,
        )
        const cookie = response.headers.get("set-cookie")
        expect(cookie).toContain("operator_session=")
        expect(cookie?.includes("Secure")).toBe(secure)
      }
    },
  )
})
