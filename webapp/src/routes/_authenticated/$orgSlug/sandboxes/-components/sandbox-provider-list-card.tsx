import { CubeIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { OrganizationSandboxProviderSummary } from "@/db/organization-sandbox-provider.server"
import { sandboxProviderDescriptors } from "@/lib/sandbox/registry"
import { SandboxConnectionStatus } from "./sandbox-connection-status"

export type SandboxProviderListCardProps = {
  organizationSlug: string
  provider: OrganizationSandboxProviderSummary
}

export function SandboxProviderListCard({
  organizationSlug,
  provider,
}: SandboxProviderListCardProps) {
  const descriptor = sandboxProviderDescriptors.find((item) => item.id === provider.providerType)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CubeIcon aria-hidden="true" />
          <Link
            to="/$orgSlug/sandboxes/$sandboxProviderId"
            params={{ orgSlug: organizationSlug, sandboxProviderId: provider.id }}
            className="min-w-0 flex-1 truncate hover:underline"
          >
            {provider.name}
          </Link>
        </CardTitle>
        <CardDescription>{descriptor?.label ?? provider.providerType}</CardDescription>
      </CardHeader>
      <CardContent>
        {provider.lastTest
          ? <SandboxConnectionStatus metadata={provider.lastTest} />
          : <p className="text-sm text-muted-foreground">Not tested yet</p>}
      </CardContent>
    </Card>
  )
}
