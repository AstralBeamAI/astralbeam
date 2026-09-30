import { createFileRoute, Outlet } from "@tanstack/react-router"

import { PublicNavbar, UnderNavbar } from "@/components/navbar"

export const Route = createFileRoute("/configure")({
  component: ConfigureLayout,
})

function ConfigureLayout() {
  return (
    <>
      <PublicNavbar />
      <UnderNavbar>
        <Outlet />
      </UnderNavbar>
    </>
  )
}
