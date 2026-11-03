import { createFileRoute } from "@tanstack/react-router"

import { LandingPage, landingPageHead } from "./-landing/landing-page"

export const Route = createFileRoute("/")({
  head: landingPageHead,
  component: LandingPage,
})
