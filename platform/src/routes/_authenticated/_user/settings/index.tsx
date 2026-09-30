import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/_user/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/account", replace: true })
  },
})
