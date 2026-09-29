import { WarningCircleIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { OrganizationPermissions } from "@/lib/organizations/access"
import { APP_NAME } from "@/lib/constants"

export function DashboardIntegrationGuide({
  organizationSlug,
  openaiApiKeyConfigured,
  apiKeyCount,
  permissions,
}: {
  organizationSlug: string
  openaiApiKeyConfigured: boolean | null
  apiKeyCount: number | null
  permissions: Pick<OrganizationPermissions, "updateOrganization" | "createApiKey" | "readApiKey">
}) {
  return (
    <Card aria-labelledby="dashboard-integration-title">
      <CardHeader>
        <CardTitle>
          <h2 id="dashboard-integration-title">Embed your first agent</h2>
        </CardTitle>
        <CardDescription>
          Connect your application to {APP_NAME}, then verify a reply and an action in your app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="list-decimal space-y-5 ps-5 text-sm marker:text-muted-foreground">
          <li className="space-y-2 ps-1">
            <h3 className="font-medium">Connect OpenAI</h3>
            {openaiApiKeyConfigured === false ? (
              <Alert variant="destructive">
                <WarningCircleIcon aria-hidden="true" />
                <AlertTitle>This organization has no OpenAI API key</AlertTitle>
                <AlertDescription>
                  Every embedded chat message is refused until one is set.
                  {!permissions.updateOrganization &&
                    " Ask an owner to add one in the organization settings."}
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-muted-foreground">
                {openaiApiKeyConfigured === true
                  ? "An OpenAI key is saved for this organization."
                  : "Ask an owner to configure the organization's OpenAI key."}{" "}
                Model usage is billed to its OpenAI account.
              </p>
            )}
            {permissions.updateOrganization && (
              <Link
                to="/$orgSlug/settings"
                params={{ orgSlug: organizationSlug }}
                className="inline-block text-primary underline underline-offset-4"
              >
                {openaiApiKeyConfigured ? "Review OpenAI key" : "Add OpenAI key"}
              </Link>
            )}
          </li>
          <li className="space-y-2 ps-1">
            <h3 className="font-medium">Prepare your server API key</h3>
            <p className="text-muted-foreground">
              {permissions.createApiKey
                ? "Create an organization API key, or use one already saved in your application's secrets. Keep it on your server, never in browser code."
                : "Ask an owner or developer to prepare an organization API key for your application server. Keep it out of browser code."}
            </p>
            {permissions.readApiKey && (
              <Link
                to="/$orgSlug/api-keys"
                params={{ orgSlug: organizationSlug }}
                className="inline-block text-primary underline underline-offset-4"
              >
                {apiKeyCount === 0 && permissions.createApiKey
                  ? "Create API key"
                  : "Manage API keys"}
              </Link>
            )}
          </li>
          <li className="space-y-2 ps-1">
            <h3 className="font-medium">Embed and try an app action</h3>
            <p className="text-muted-foreground">
              Follow the quickstart to authenticate your app&apos;s users, add a token endpoint, and
              mount the widget. Send a message, then connect a tool that changes your app.
            </p>
            <Link
              to="/docs/$section/$page"
              params={{ section: "start", page: "quickstart" }}
              className="inline-block text-primary underline underline-offset-4"
            >
              Follow the quickstart
            </Link>
          </li>
        </ol>
      </CardContent>
    </Card>
  )
}
