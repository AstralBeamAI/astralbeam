import { CheckIcon } from "@phosphor-icons/react"
import { Link, linkOptions } from "@tanstack/react-router"
import { useId, useState } from "react"

import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { OrganizationPermissions } from "@/lib/organizations/access"
import { APP_NAME } from "@/lib/constants"

export function DashboardIntegrationGuide({
  organizationSlug,
  modelSetup,
  usableApiKeyCount,
  permissions,
}: {
  organizationSlug: string
  modelSetup: {
    providerCount: number
    enabledModelCount: number
    defaultAgentModelCount: number
    defaultAgentId: string | null
  } | null
  usableApiKeyCount: number | null
  permissions: Pick<
    OrganizationPermissions,
    "readConfiguration" | "updateConfiguration" | "createApiKey" | "readApiKey"
  >
}) {
  const titleId = useId()
  const steps = [
    {
      title: "Add a provider and enable models",
      complete: modelSetup !== null && modelSetup.enabledModelCount > 0,
      description: permissions.updateConfiguration
        ? "Add your provider credentials and enable the models your agents can use. Test a saved model to check that it can reply."
        : "Ask an owner or developer to configure a provider and enable models.",
      link: linkOptions({ to: "/$orgSlug/models", params: { orgSlug: organizationSlug } }),
      action:
        modelSetup?.providerCount === 0 && permissions.updateConfiguration
          ? "Add model provider"
          : "Manage models",
      visible: permissions.readConfiguration,
    },
    {
      title: "Choose your agent’s models",
      complete: modelSetup !== null && modelSetup.defaultAgentModelCount > 0,
      description: permissions.updateConfiguration
        ? "Choose a default agent, give it instructions, and assign an enabled model so it can reply."
        : "Ask an owner or developer to configure the default agent’s instructions and model.",
      link: modelSetup?.defaultAgentId
        ? linkOptions({
            to: "/$orgSlug/agents/$agentId",
            params: { orgSlug: organizationSlug, agentId: modelSetup.defaultAgentId },
          })
        : linkOptions({ to: "/$orgSlug/agents", params: { orgSlug: organizationSlug } }),
      action: modelSetup?.defaultAgentId ? "Configure default agent" : "Set up an agent",
      visible: permissions.readConfiguration,
    },
    {
      title: "Prepare your server API key",
      complete: usableApiKeyCount !== null && usableApiKeyCount > 0,
      description: permissions.createApiKey
        ? "Create an API key, or use one already saved in your app’s secrets. Keep it on your server, never in browser code."
        : "Ask an owner or developer to prepare an API key for your application server.",
      link: linkOptions({ to: "/$orgSlug/api-keys", params: { orgSlug: organizationSlug } }),
      action:
        usableApiKeyCount === 0 && permissions.createApiKey ? "Create API key" : "Manage API keys",
      visible: permissions.readApiKey,
    },
    {
      title: "Embed and verify in your app",
      complete: false,
      description:
        "Follow the quickstart to authenticate your app’s users and mount the widget. Verify a reply, then connect a tool and try an app action.",
      link: linkOptions({
        to: "/docs/$section/$page",
        params: { section: "start", page: "quickstart" },
      }),
      action: "Follow the quickstart",
      visible: true,
    },
  ]
  const nextStep = steps.findIndex((step) => !step.complete && step.visible)
  const [expanded, setExpanded] = useState<number | null>(null)
  const activeStep = expanded ?? nextStep
  const configured = steps.slice(0, -1).every((step) => step.complete)

  return (
    <Card aria-labelledby={titleId} className="max-w-4xl">
      <CardHeader>
        <CardTitle>
          <h2 id={titleId}>{configured ? "Connect your app" : "Embed your first agent"}</h2>
        </CardTitle>
        <CardDescription>
          {configured
            ? "Your configuration is in place. Verify a reply and an action in your own app."
            : `Set up ${APP_NAME}, then verify a reply and an action in your app.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="divide-y">
          {steps.map((step, index) => (
            <li key={step.title} className="py-3 first:pt-0 last:pb-0">
              <h3>
                <button
                  type="button"
                  aria-expanded={activeStep === index}
                  aria-controls={`${titleId}-${index}`}
                  onClick={() => setExpanded(activeStep === index ? -1 : index)}
                  className="flex w-full items-center gap-3 rounded-sm text-left text-sm font-medium outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring any-pointer-coarse:min-h-11 any-pointer-coarse:min-w-11"
                >
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs"
                    aria-hidden="true"
                  >
                    {step.complete ? <CheckIcon /> : index + 1}
                  </span>
                  <span className="flex-1">{step.title}</span>
                  {step.complete && (
                    <span className="text-xs font-normal text-muted-foreground">Configured</span>
                  )}
                </button>
              </h3>
              <div
                id={`${titleId}-${index}`}
                hidden={activeStep !== index}
                className="space-y-3 pt-2 ps-9"
              >
                <p className="max-w-prose text-sm text-muted-foreground">{step.description}</p>
                {step.visible && (
                  <Link
                    {...step.link}
                    className={buttonVariants({
                      variant: index === nextStep ? "default" : "outline",
                      size: "sm",
                    })}
                  >
                    {step.action}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
