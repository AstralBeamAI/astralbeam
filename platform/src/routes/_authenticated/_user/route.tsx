import { createFileRoute, Outlet } from "@tanstack/react-router"

import { DocsLink, Navbar, UnderNavbar } from "@/components/navbar"
import { AppUserButton } from "../-components/app-user-button"

export const Route = createFileRoute("/_authenticated/_user")({
  component: UserLayout,
})

/** User-level pages belong to no organization, so they skip the sidebar, switcher, and Astro. */
function UserLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <Navbar wordmark>
        <DocsLink />
        <AppUserButton align="end" size="icon" className="ms-2.5" />
      </Navbar>
      <main className="flex flex-1 flex-col">
        <UnderNavbar>
          <Outlet />
        </UnderNavbar>
      </main>
    </div>
  )
}
