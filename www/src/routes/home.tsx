import { createFileRoute } from "@tanstack/react-router"

import { LandingPage, landingPageHead } from "./-landing/landing-page"

// The platform answers `/` with the dashboard once signed in, so it serves this copy at `/home`.
export const Route = createFileRoute("/home")({
  head: landingPageHead,
  component: LandingPage,
})
