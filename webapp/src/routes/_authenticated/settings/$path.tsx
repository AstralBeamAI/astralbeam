import { createFileRoute, notFound } from "@tanstack/react-router"

import { Settings } from "@/components/auth/settings/settings"

const settingsPaths = new Set(["account", "security", "organizations"])

export const Route = createFileRoute("/_authenticated/settings/$path")({
  beforeLoad: ({ params }) => {
    if (!settingsPaths.has(params.path)) throw notFound()
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { path } = Route.useParams()
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <Settings path={path} />
    </main>
  )
}
