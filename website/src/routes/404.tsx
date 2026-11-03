import { createFileRoute } from "@tanstack/react-router"

import { SignalLost } from "@/components/signal-lost"
import { pageHead } from "@/lib/page-head"

// Prerendered as its own route so the build emits `404.html`, which the Cloudflare assets
// `404-page` handling serves. https://developers.cloudflare.com/workers/static-assets/routing/
export const Route = createFileRoute("/404")({
  head: () =>
    pageHead({
      title: "404 - Signal lost | AstralBeam",
      description: "The requested AstralBeam page does not exist.",
    }),
  component: SignalLost,
})
