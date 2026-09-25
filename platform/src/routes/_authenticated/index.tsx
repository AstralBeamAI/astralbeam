import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/")({
  beforeLoad: ({ context: { access } }) => {
    throw redirect({
      href: access.status === "ready" ? `/${access.organizationSlug}` : "/onboarding",
      replace: true,
    })
  },
})
