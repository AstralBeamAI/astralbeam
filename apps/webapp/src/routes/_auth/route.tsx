import { authSessionQueryOptions } from "@astralbeam/auth/tanstack/queries"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_auth")({
  component: Outlet,
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData({
      ...authSessionQueryOptions,
      revalidateIfStale: true,
    })

    if (!session) {
      throw redirect({
        to: "/auth/$path",
        params: { path: "sign-in" },
        search: { redirectTo: location.href },
      })
    }

    return { user: session.user }
  },
})
