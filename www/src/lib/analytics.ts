import posthog from "posthog-js"

if (window.location.origin === "https://astralbeam.ai") {
  posthog.init("phc_CxMzFhGR4Xv4pZnTdrgxnUsCTt93wMaPNdPdUadBpwrn", {
    defaults: "2026-05-30",
    mask_all_text: true,
    mask_all_element_attributes: true,
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
