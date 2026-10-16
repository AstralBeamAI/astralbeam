import { StartClient } from "@tanstack/react-start/client"
import { PostHogProvider } from "@posthog/react"
import posthog from "posthog-js"
import { StrictMode, startTransition } from "react"
import { hydrateRoot } from "react-dom/client"

import { initAnalytics } from "@www/lib/analytics"

initAnalytics({ capture_pageview: false, capture_pageleave: true })

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <PostHogProvider client={posthog}>
        <StartClient />
      </PostHogProvider>
    </StrictMode>,
  )
})
