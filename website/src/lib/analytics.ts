import { redactSensitiveValue } from "@platform/lib/redaction"
import posthog, { type CaptureResult } from "posthog-js"

function redactAnalyticsValue(key: string, value: unknown): unknown {
  if ((key === "requestBody" || key === "responseBody") && typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value, redactSensitiveValue))
    } catch {
      // Unstructured bodies cannot be safely split into fields. Suppress one if a secret is found.
      return redactSensitiveValue("", value) === value ? value : "[REDACTED]"
    }
  }
  const redacted = redactSensitiveValue(key, value)
  if (Array.isArray(redacted)) return redacted.map((entry) => redactAnalyticsValue(key, entry))
  if (redacted !== null && typeof redacted === "object" && !(redacted instanceof Date))
    return Object.fromEntries(
      Object.entries(redacted).map(([name, entry]) => [
        name,
        // Replay hooks already redact DOM data. Its gzip bytes must remain unchanged here.
        // https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/extensions/replay/external/lazy-loaded-session-recorder.ts
        key === "$snapshot_data" && name === "data" && "cv" in redacted && redacted.cv === "2024-10"
          ? entry
          : redactAnalyticsValue(name, entry),
      ]),
    )
  return redacted
}

if (window.location.origin === "https://astralbeam.ai") {
  posthog.init("phc_CxMzFhGR4Xv4pZnTdrgxnUsCTt93wMaPNdPdUadBpwrn", {
    defaults: "2026-05-30",
    // Extend PostHog's network scrubber with application credentials. Network and page URLs stay uncompressed.
    // https://posthog.com/docs/libraries/js/usage#redacting-information-in-events
    before_send: (event) => {
      // Network "name" is a URL: ?token=secret&version=3 → ?token=[REDACTED]&version=3.
      const redacted = redactAnalyticsValue("", event) as CaptureResult
      // The SDK's public ingestion token is required for delivery, unlike nested user tokens.
      redacted.properties.token = event.properties.token as string
      return redacted
    },
    session_recording: {
      maskAllInputs: false,
      // "*" sends all replay text through the selective redactor, which keeps ordinary content.
      // Replay DOM is compressed before before_send, so text and attributes need capture-time hooks.
      maskTextSelector: "*",
      // CSS context preserves variables such as --th-token: #24292f while still redacting credentials.
      maskTextFn: (text, element) =>
        redactSensitiveValue(element?.tagName === "STYLE" ? "style" : "", text),
      // Preserve styling and ordinary attributes. Input names identify opaque credential values.
      // https://posthog.com/docs/session-replay/privacy
      maskAttributeFn: (name, value, element) =>
        redactSensitiveValue(
          name === "value" ? (element?.getAttribute("name") ?? name) : name,
          value,
        ),
      // Leave network capture to project settings and retain the SDK's header/body scrubber.
      // A maskCapturedNetworkRequestFn would replace it: https://posthog.com/docs/session-replay/network-recording
    },
  })
}
