import { createFileRoute, redirect } from "@tanstack/react-router"

// `~` stands in for the active organization's slug, so `/~/tenants` opens its tenants page.
export const Route = createFileRoute("/_authenticated/~/$")({
  beforeLoad: ({ context: { access }, location, params }) => {
    if (access.status !== "ready") throw redirect({ href: "/onboarding", replace: true })
    const suffix = params._splat ? `/${params._splat}` : ""
    throw redirect({
      href: `/${access.organizationSlug}${suffix}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    })
  },
})
