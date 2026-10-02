import { WarningCircleIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { OrganizationPermissions } from "@/lib/organizations/access"
import { APP_NAME } from "@/lib/constants"

export function DashboardIntegrationGuide({
  organizationSlug,
  modelSetup,
  apiKeyCount,
  permissions,
}: {
  organizationSlug: string
  modelSetup: {
    providerCount: number
    enabledModelCount: number
    defaultAgentModelCount: number
    defaultAgentId: string | null
  } | null
  apiKeyCount: number | null
  permissions: Pick<
    OrganizationPermissions,
    "readConfiguration" | "updateConfiguration" | "createApiKey" | "readApiKey"
  >
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
            <h3 className="font-medium">Add a provider and enable models</h3>
            {modelSetup !== null && modelSetup.enabledModelCount === 0 ? (
              <Alert variant="destructive">
                <WarningCircleIcon aria-hidden="true" />
                <AlertTitle>No provider models are enabled</AlertTitle>
                <AlertDescription>
                  {modelSetup.providerCount === 0
                    ? "Add a named provider with its API key and API URL, then enable the models your agents can use."
                    : "Enable at least one model on a provider before configuring your agent."}
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-muted-foreground">
                {modelSetup !== null
                  ? "Provider models are saved. Saving a key or enabling a model does not verify provider access."
                  : "Ask an owner or developer to configure a model provider and enable models."}
              </p>
            )}
            {permissions.readConfiguration && (
              <Link
                to="/$orgSlug/models"
                params={{ orgSlug: organizationSlug }}
                className="inline-block text-primary underline underline-offset-4"
              >
                {modelSetup?.providerCount === 0 && permissions.updateConfiguration
                  ? "Add model provider"
                  : "Manage models"}
              </Link>
            )}
          </li>
          <li className="space-y-2 ps-1">
            <h3 className="font-medium">Choose your agent&apos;s models</h3>
            <p className="text-muted-foreground">
              {modelSetup === null
                ? "Ask an owner or developer to configure the default agent's model."
                : !modelSetup.defaultAgentId
                  ? "Choose an agent and set it as the organization's default."
                  : modelSetup.defaultAgentModelCount === 0
                    ? "Your default agent has no model and cannot reply yet. Assign an enabled provider model."
                    : "Your default agent has models assigned. Verify a reply in your application to check provider access."}
            </p>
            {permissions.readConfiguration &&
              (modelSetup?.defaultAgentId ? (
                <Link
                  to="/$orgSlug/agents/$agentId"
                  params={{ orgSlug: organizationSlug, agentId: modelSetup.defaultAgentId }}
                  className="inline-block text-primary underline underline-offset-4"
                >
                  Configure default agent
                </Link>
              ) : (
                <Link
                  to="/$orgSlug/agents"
                  params={{ orgSlug: organizationSlug }}
                  className="inline-block text-primary underline underline-offset-4"
                >
                  Set up an agent
                </Link>
              ))}
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
