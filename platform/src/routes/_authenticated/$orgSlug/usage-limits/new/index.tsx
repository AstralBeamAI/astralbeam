import { ArrowLeftIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"

import { APP_NAME } from "@/lib/constants"
import { UsageLimitForm } from "../-components/usage-limit-form"

export const Route = createFileRoute("/_authenticated/$orgSlug/usage-limits/new/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.updateConfiguration) {
      throw redirect({
        to: "/$orgSlug/usage-limits",
        params: { orgSlug: params.orgSlug },
        replace: true,
      })
    }
  },
  component: NewUsageLimitPage,
  head: () => ({ meta: [{ title: `New usage limit · ${APP_NAME}` }] }),
})

function NewUsageLimitPage() {
  const { orgSlug } = Route.useParams()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <Link
          to="/$orgSlug/usage-limits"
          params={{ orgSlug }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Usage Limits
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Add usage limit</h1>
        <p className="text-sm text-muted-foreground">
          Cap the tokens or spend that chat can use in each window.
        </p>
      </div>
      <UsageLimitForm organizationSlug={orgSlug} usageLimit={null} readOnly={false} />
    </div>
  )
}
