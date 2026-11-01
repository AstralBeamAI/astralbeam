import { setupReactErrorHandler } from "@posthog/react"
import { redactSensitiveValue } from "@platform/lib/redaction"
import posthog, { type CaptureResult } from "posthog-js"

function redactAnalyticsValue(key: string, value: unknown): unknown {
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

const isHostedAnalyticsOrigin = window.location.origin === "https://astralbeam.ai"
const posthogReactErrorHandler = setupReactErrorHandler(posthog)

function captureReactError(error: unknown, errorInfo: { componentStack?: string | undefined }) {
  posthogReactErrorHandler(error, { componentStack: errorInfo.componentStack ?? null })
}

export const reactErrorHandlers = isHostedAnalyticsOrigin
  ? {
      onCaughtError: captureReactError,
      onUncaughtError: captureReactError,
      onRecoverableError: captureReactError,
    }
  : undefined

if (isHostedAnalyticsOrigin) {
  posthog.init("phc_CxMzFhGR4Xv4pZnTdrgxnUsCTt93wMaPNdPdUadBpwrn", {
    api_host: "https://e.astralbeam.ai",
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    capture_exceptions: true,
    tracing_headers: ["astralbeam.ai"],
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
      // Configure login and secret-reveal bodies contain opaque credentials under generic keys or as raw strings.
      recordBody: false,
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
      // Leave header capture to project settings and retain the SDK's native network scrubber.
      // A maskCapturedNetworkRequestFn would replace it: https://posthog.com/docs/session-replay/network-recording
    },
  })
}
