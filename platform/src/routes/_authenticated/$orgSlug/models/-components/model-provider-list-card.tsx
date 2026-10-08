import { CpuIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { modelProviderDescriptors } from "../-lib/constants"
import type { ModelProviderListItem } from "@/lib/model-providers/model-providers.server"

export function ModelProviderListCard({
  organizationSlug,
  provider,
}: {
  organizationSlug: string
  provider: ModelProviderListItem
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CpuIcon aria-hidden="true" />
          <Link
            to="/$orgSlug/models/$modelProviderId"
            params={{ orgSlug: organizationSlug, modelProviderId: provider.id }}
            className="min-w-0 flex-1 truncate hover:underline"
          >
            {provider.name}
          </Link>
          <Badge variant="secondary">{modelProviderDescriptors[provider.providerType].label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="truncate text-xs text-muted-foreground">{provider.baseUrl}</p>
        <p className="text-sm">
          {provider.models.length} enabled {provider.models.length === 1 ? "model" : "models"}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {provider.models.map((model) => (
            <Badge key={model.id} variant="outline">
              {model.name}
            </Badge>
          ))}
        </div>
        {provider.models.some((model) => model.usageConfiguration === null) && (
          <p className="text-sm text-destructive">
            Configure prices and token limits for models that are not ready.
          </p>
        )}
        {!provider.credentialsReadable && (
          <p className="text-sm text-destructive">
            Save the API key again to restore this provider.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
