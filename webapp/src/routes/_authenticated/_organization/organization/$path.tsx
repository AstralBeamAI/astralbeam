import { createFileRoute, notFound } from "@tanstack/react-router"

import { Organization } from "@/components/auth/organization/organization"

const organizationPaths = new Set(["people", "settings"])

export const Route = createFileRoute("/_authenticated/_organization/organization/$path")({
  beforeLoad: ({ params }) => {
    if (!organizationPaths.has(params.path)) throw notFound()
  },
  component: OrganizationPage,
})

function OrganizationPage() {
  const { path } = Route.useParams()
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 py-12">
      <Organization path={path} />
    </main>
  )
}
