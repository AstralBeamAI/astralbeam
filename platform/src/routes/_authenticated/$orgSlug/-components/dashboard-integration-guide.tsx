import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react"
import { Link, linkOptions, useRouter } from "@tanstack/react-router"
import { useId, useState } from "react"
import { cn } from "cn"

import { CreateApiKeyDialog } from "@/components/auth/api-key/create-api-key-dialog"
import { DocsLink } from "@/components/docs-link"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import type { OrganizationPermissions } from "@/lib/organizations/access"

export function DashboardIntegrationGuide({
  organizationId,
  organizationSlug,
  modelSetup,
  usableApiKeyCount,
  hasConversations,
  permissions,
}: {
  organizationId: string
  organizationSlug: string
  modelSetup: {
    providerCount: number
    enabledModelCount: number
    defaultAgentModelCount: number
    defaultAgentId: string | null
  } | null
  usableApiKeyCount: number | null
  hasConversations: boolean | null
  permissions: Pick<
    OrganizationPermissions,
    "readConfiguration" | "updateConfiguration" | "createApiKey" | "readApiKey"
  >
}) {
  const router = useRouter()
  const titleId = useId()
  const [createApiKeyOpen, setCreateApiKeyOpen] = useState(false)
  const addProvider = modelSetup?.providerCount === 0 && permissions.updateConfiguration
  const showCreateApiKey = usableApiKeyCount === 0 && permissions.createApiKey
  const steps = [
    {
      title: "Connect a model provider",
      complete: modelSetup !== null && modelSetup.enabledModelCount > 0,
      description: permissions.updateConfiguration
        ? "Add your provider credentials and enable the models your agents can use. Test a saved model to check that it can reply."
        : "Ask an owner or developer to configure a provider and enable models.",
      link: linkOptions({
        to: addProvider ? "/$orgSlug/models/new" : "/$orgSlug/models",
        params: { orgSlug: organizationSlug },
      }),
      action: addProvider ? "Add model provider" : "Manage models",
      visible: permissions.readConfiguration,
    },
    {
      title: "Give your agent a model",
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
      title: "Create a server API key",
      complete: usableApiKeyCount !== null && usableApiKeyCount > 0,
      description: permissions.createApiKey
        ? "Create an API key, or use one already saved in your app’s secrets. Keep it on your server, never in browser code."
        : "Ask an owner or developer to prepare an API key for your application server.",
      link: linkOptions({ to: "/$orgSlug/api-keys", params: { orgSlug: organizationSlug } }),
      action: showCreateApiKey ? "Create API key" : "Manage API keys",
      onClick: showCreateApiKey ? () => setCreateApiKeyOpen(true) : undefined,
      visible: permissions.readApiKey,
    },
    {
      title: "Embed and verify in your app",
      complete: hasConversations === true,
      description:
        "Follow the quickstart to authenticate your app’s users and mount the widget. Verify a reply, then connect a tool and try an app action.",
      link: { href: "/docs/start/quickstart" },
      action: "Follow the quickstart",
      visible: true,
    },
  ]
  const setupKnown = modelSetup !== null && usableApiKeyCount !== null
  const nextStep = setupKnown ? steps.findIndex((step) => !step.complete && step.visible) : -1
  const [expanded, setExpanded] = useState<number | null>(null)
  const completed = steps.filter((step) => step.complete).length

  const activeStep = expanded ?? Math.max(nextStep, 0)
  const configured = steps.slice(0, -1).every((step) => step.complete)
  const introduction = (() => {
    if (!setupKnown)
      return {
        title: "Organization setup",
        description:
          "An owner or developer manages setup. You can browse customer activity and members from the sidebar.",
      }
    if (configured)
      return {
        title: "Connect your app",
        description:
          "Your configuration is in place. Verify a reply and an action in your own app.",
      }
    return {
      title: "Set up your first agent",
      description:
        "Start with a model, then connect your agent to your app. Your progress is saved as you go.",
    }
  })()

  const guide = (
    <Card aria-labelledby={titleId} className="max-w-4xl text-sm sm:[--card-spacing:--spacing(6)]">
      <CardHeader className="gap-3">
        <h2 id={titleId} className="font-sans text-sm font-medium">
          {introduction.title}
        </h2>
        <CardDescription className="text-sm">{introduction.description}</CardDescription>
        {setupKnown && (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              {completed} of {steps.length} setup steps complete
            </p>
            <progress
              value={completed}
              max={steps.length}
              aria-label="Organization setup"
              className="block h-1.5 w-full appearance-none overflow-hidden bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
            />
          </div>
        )}
      </CardHeader>
      <CardContent>
        <ol className="divide-y">
          {steps.map((step, index) => {
            const actionClassName = cn(
              buttonVariants({
                variant: index === nextStep ? "default" : "outline",
                size: "sm",
              }),
              "text-sm",
            )
            return (
              <li
                key={step.title}
                aria-current={index === nextStep ? "step" : undefined}
                className="py-4 first:pt-0 last:pb-0"
              >
                <h3 className="font-sans">
                  <button
                    type="button"
                    aria-expanded={activeStep === index}
                    aria-controls={`${titleId}-${index}`}
                    onClick={() => setExpanded(activeStep === index ? -1 : index)}
                    className="flex w-full items-center gap-3 rounded-sm text-left text-sm font-medium outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring any-pointer-coarse:min-h-11 any-pointer-coarse:min-w-11"
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full border",
                        (step.complete || index === nextStep) &&
                          "border-primary bg-primary text-primary-foreground",
                      )}
                      aria-hidden="true"
                    >
                      {step.complete ? <CheckIcon /> : index + 1}
                    </span>
                    <span className="flex-1">{step.title}</span>
                    {step.complete && (
                      <span className="font-normal text-muted-foreground">Configured</span>
                    )}
                    {index === nextStep && <span className="text-primary">Next</span>}
                    <CaretDownIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground",
                        activeStep === index && "rotate-180",
                      )}
                    />
                  </button>
                </h3>
                <div
                  id={`${titleId}-${index}`}
                  hidden={activeStep !== index}
                  className="space-y-3 pt-3 ps-10"
                >
                  <p className="max-w-prose text-sm text-muted-foreground">{step.description}</p>
                  {step.visible &&
                    (step.onClick ? (
                      <Button type="button" className={actionClassName} onClick={step.onClick}>
                        {step.action}
                      </Button>
                    ) : "href" in step.link ? (
                      <DocsLink
                        {...step.link}
                        target="_self"
                        preload="intent"
                        className={cn(actionClassName, "no-underline")}
                      >
                        {step.action}
                      </DocsLink>
                    ) : (
                      <Link {...step.link} className={actionClassName}>
                        {step.action}
                      </Link>
                    ))}
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )

  return (
    <>
      {completed < steps.length && guide}
      {/* Keep the one-time key dialog mounted when creation completes the checklist. */}
      {permissions.readApiKey && permissions.createApiKey && (
        <CreateApiKeyDialog
          organizationId={organizationId}
          open={createApiKeyOpen}
          onOpenChange={(open) => {
            setCreateApiKeyOpen(open)
            if (!open) void router.invalidate()
          }}
        />
      )}
    </>
  )
}
