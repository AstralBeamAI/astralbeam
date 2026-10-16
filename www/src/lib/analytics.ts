import posthog from "posthog-js"

if (window.location.origin === "https://astralbeam.ai") {
  posthog.init("phc_CxMzFhGR4Xv4pZnTdrgxnUsCTt93wMaPNdPdUadBpwrn", {
    defaults: "2026-05-30",
    person_profiles: "never",
    respect_dnt: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    property_denylist: ["title", "$title"],
    capture_performance: {
      network_timing: false,
      web_vitals_attribution: false,
    },
    enable_recording_console_log: false,
    session_recording: {
      // Attribute masking also protects signed image links and hidden inputs. https://posthog.com/docs/session-replay/privacy
      maskTextSelector: "*",
      maskAllElementAttributes: true,
      // Keep network content private even if enabled remotely. https://posthog.com/docs/session-replay/network-recording
      recordHeaders: false,
      recordBody: false,
    },
  })
}
