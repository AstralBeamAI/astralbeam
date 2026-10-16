import posthog from "posthog-js"

function redactToken(url: string): string {
  return url.replace(/([?&#]token=)[^&#]*/giu, "$1[redacted]")
}

function redactUrlTokens(value: unknown): void {
  if (value === null || typeof value !== "object") return
  const properties = value as Record<string, unknown>
  for (const [key, item] of Object.entries(properties)) {
    if (typeof item === "string" && /url|href|referrer/iu.test(key)) {
      properties[key] = redactToken(item)
    } else {
      redactUrlTokens(item)
    }
  }
}

if (window.location.origin === "https://astralbeam.ai") {
  posthog.init("phc_CxMzFhGR4Xv4pZnTdrgxnUsCTt93wMaPNdPdUadBpwrn", {
    defaults: "2026-05-30",
    mask_all_text: true,
    mask_all_element_attributes: true,
    before_send: (event) => {
      redactUrlTokens(event)
      return event
    },
    session_recording: {
      // Attribute masking also protects signed image links and hidden inputs. https://posthog.com/docs/session-replay/privacy
      maskTextSelector: "*",
      maskAllElementAttributes: true,
      // Keep network content private even if enabled remotely. https://posthog.com/docs/session-replay/network-recording
      recordHeaders: false,
      recordBody: false,
      maskCapturedNetworkRequestFn: (request) => ({ ...request, name: redactToken(request.name) }),
    },
  })
}
