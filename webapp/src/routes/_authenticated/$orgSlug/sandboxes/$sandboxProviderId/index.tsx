import { ArrowLeftIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router"
import * as Schema from "effect/Schema"

import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { sandboxProviderDescriptors } from "@/lib/sandbox/registry"
import { UuidV7Schema } from "@/lib/schemas"
import { SandboxConnectionStatus } from "../-components/sandbox-connection-status"
import { SandboxProviderForm } from "../-components/sandbox-provider-form"
import { SandboxProviderActions } from "./-components/sandbox-provider-actions"
import { getSandboxProviderPageData } from "./-functions/get-sandbox-provider-page-data"

/** Sandbox providers have no slug, so the URL carries the internal UUID. */
const isSandboxProviderId = Schema.is(UuidV7Schema)

export const Route = createFileRoute("/_authenticated/$orgSlug/sandboxes/$sandboxProviderId/")({
  // This page returns decrypted credentials for masked editing, so nothing about it is preloaded,
  // retained after navigation, or rendered from a stale cache.
  preload: false,
  gcTime: 0,
  beforeLoad: ({ context, params }) => {
    if (!isSandboxProviderId(params.sandboxProviderId)) throw notFound()
    if (!context.organization.permissions.readConfiguration) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: {
    staleReloadMode: "blocking",
    handler: async ({ params }) => {
      const page = await getSandboxProviderPageData({
        data: {
          organizationSlug: params.orgSlug,
          sandboxProviderId: params.sandboxProviderId,
        },
      })
      if (!page) throw notFound()
      return page
    },
  },
  component: SandboxProviderPage,
  pendingComponent: SandboxProviderPageSkeleton,
  head: () => ({ meta: [{ title: `Sandbox provider · ${APP_NAME}` }] }),
})

function SandboxProviderPage() {
  const { orgSlug } = Route.useParams()
  const { data, permissions } = Route.useLoaderData()
  const descriptor = sandboxProviderDescriptors.find(
    (item) => item.id === data.provider.providerType,
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <Link
          to="/$orgSlug/sandboxes"
          params={{ orgSlug }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Sandboxes
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {data.provider.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {descriptor?.label ?? data.provider.providerType}
        </p>
      </div>

      {data.provider.lastTest && (
        <div className="max-w-2xl">
          <SandboxConnectionStatus metadata={data.provider.lastTest} />
        </div>
      )}

      <SandboxProviderActions
        organizationSlug={orgSlug}
        provider={data.provider}
        canTest={permissions.testConfiguration}
        canDelete={permissions.deleteConfiguration}
      />

      {
        /* Remounting on the lock version keeps the editor's local state tied to the snapshot it
        was initialized from, so a save after a conflict cannot carry the stale one forward. */
      }
      <SandboxProviderForm
        key={`${data.provider.id}:${data.provider.lockVersion}`}
        organizationSlug={orgSlug}
        provider={data.provider}
        readOnly={!permissions.updateConfiguration}
      />
    </div>
  )
}

function SandboxProviderPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-16 w-full max-w-2xl rounded-xl" />
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-96 w-full max-w-2xl rounded-xl" />
    </div>
  )
}
