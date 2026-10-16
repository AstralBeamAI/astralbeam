import posthog from "posthog-js"

function redactAnalyticsUrls(value: unknown): void {
  if (value === null || typeof value !== "object") return
  const properties = value as Record<string, unknown>
  for (const [key, item] of Object.entries(properties)) {
    if (typeof item === "string" && /url|href|referrer/iu.test(key)) {
      properties[key] = item.replace(/[?#].*/su, "")
    } else {
      redactAnalyticsUrls(item)
    }
  }
}

if (window.location.origin === "https://astralbeam.ai") {
  posthog.init("phc_CxMzFhGR4Xv4pZnTdrgxnUsCTt93wMaPNdPdUadBpwrn", {
    defaults: "2026-05-30",
    person_profiles: "never",
    respect_dnt: true,
    disable_capture_url_hashes: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    property_denylist: ["title", "$title", "ph_keyword", "$session_entry_ph_keyword"],
    save_campaign_params: false,
    // Flags also send persisted initial URLs outside before_send. https://github.com/PostHog/posthog-js/blob/main/packages/browser-common/src/feature-flags.ts
    save_referrer: false,
    capture_performance: {
      network_timing: false,
      web_vitals_attribution: false,
    },
    enable_recording_console_log: false,
    // Preserve SDK values such as Date timestamps. https://posthog.com/docs/libraries/js/usage#amending-or-sampling-events
    before_send: (event) => {
      redactAnalyticsUrls(event)
      return event
    },
    session_recording: {
      // Attribute masking also protects signed image links and hidden inputs. https://posthog.com/docs/session-replay/privacy
      maskTextSelector: "*",
      maskAllElementAttributes: true,
      maskCapturedNetworkRequestFn: (request) => ({
        ...request,
        name: request.name.replace(/[?#].*/su, ""),
      }),
    },
  })
}
