import {
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  KeyIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { Link, linkOptions, useRouter } from "@tanstack/react-router"
import { parseMarkdown } from "@tanstack/markdown"
import { docsMarkdownExtensions } from "@tanstack/markdown/extensions/docs"
import { type ReactNode, useEffect, useId, useMemo, useState } from "react"
import { cn } from "cn"
import { agentSetupPrompt } from "@website/lib/agent-setup-prompt"

import { CreateApiKeyDialog } from "@/components/auth/api-key/create-api-key-dialog"
import { DocsMarkdown } from "@/components/docs/docs-markdown"
import { DocsLink } from "@/components/docs-link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { OrganizationPermissions } from "@/lib/organizations/access"
import type { IntegrationGuideStep } from "@/lib/organizations/schemas"
import { getAppReplyStatus } from "../-functions/get-app-reply-status"
import { markIntegrationGuideStep } from "../-functions/mark-integration-guide-step"
import { integrationSnippets } from "../-lib/integration-snippets"

const REPLY_POLL_INTERVAL_MS = 3000

function IntegrationCode({ markdown }: { markdown: string }) {
  const parsed = useMemo(
    () => parseMarkdown(markdown, { extensions: docsMarkdownExtensions() }),
    [markdown],
  )
  return (
    <div className="min-w-0 text-sm [&_.docs-markdown]:leading-6">
      <DocsMarkdown markdown={parsed} sectionSlug="start" />
    </div>
  )
}

const stepCircle =
  "flex size-7 items-center justify-center rounded-full border bg-background text-xs font-medium"
const completeStepCircle = "border-primary bg-primary text-primary-foreground"

function GuideStep({
  number,
  title,
  detected = false,
  marked,
  onMarkedChange,
  children,
}: {
  number: number
  title: string
  detected?: boolean
  marked: boolean
  onMarkedChange: ((marked: boolean) => void) | undefined
  children: ReactNode
}) {
  const complete = detected || marked
  const markLabel = marked ? "Mark as not done" : "Mark as done"
  // Detection during this visit keeps the step open, so new keys and first replies stay visible.
  const [detectedOnLoad] = useState(detected)
  const [openOverride, setOpenOverride] = useState<boolean>()
  return (
    <li className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-4 pb-8 last:pb-0">
      <span
        aria-hidden="true"
        className="absolute top-9 bottom-1 start-3.5 w-px -translate-x-1/2 bg-border in-[li:last-child]:hidden"
      />
      <span aria-hidden="true" className={cn(stepCircle, complete && completeStepCircle)}>
        {complete ? <CheckIcon /> : number}
      </span>
      <Collapsible
        open={openOverride ?? !(marked || detectedOnLoad)}
        onOpenChange={setOpenOverride}
        className="min-w-0"
      >
        <div className="flex items-center gap-2">
          <h3 className="flex-1 font-sans text-sm font-medium">
            <CollapsibleTrigger className="w-full cursor-pointer py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {title}
              {complete && <span className="sr-only"> (complete)</span>}
            </CollapsibleTrigger>
          </h3>
          {!detected && onMarkedChange && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => {
                      onMarkedChange(!marked)
                      setOpenOverride(undefined)
                    }}
                  />
                }
              >
                {marked ? (
                  <ArrowCounterClockwiseIcon aria-hidden="true" data-icon="inline-start" />
                ) : (
                  <CheckIcon aria-hidden="true" data-icon="inline-start" />
                )}
                <span className="max-sm:sr-only">{markLabel}</span>
              </TooltipTrigger>
              {/* Narrow screens show only the icon, so the tooltip names the action there. */}
              <TooltipContent className="sm:hidden">{markLabel}</TooltipContent>
            </Tooltip>
          )}
          {/* A pointer shortcut for the title button, which carries the accessible state. */}
          <CollapsibleTrigger
            aria-hidden="true"
            tabIndex={-1}
            className="group cursor-pointer p-1 text-muted-foreground"
          >
            <CaretDownIcon className="size-4 transition-transform group-aria-expanded:rotate-180" />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="space-y-3 pt-3">{children}</CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="max-w-prose text-sm text-muted-foreground">{children}</p>
}

const inlineCode = "rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"

function defaultAgentLink(organizationSlug: string, defaultAgentId: string | null) {
  return defaultAgentId
    ? linkOptions({
        to: "/$orgSlug/agents/$agentId",
        params: { orgSlug: organizationSlug, agentId: defaultAgentId },
      })
    : linkOptions({ to: "/$orgSlug/agents", params: { orgSlug: organizationSlug } })
}

function CustomizeLinks({
  organizationSlug,
  defaultAgentId,
  canConfigure,
  canInvite,
}: {
  organizationSlug: string
  defaultAgentId: string | null
  canConfigure: boolean
  canInvite: boolean
}) {
  const params = { orgSlug: organizationSlug }
  // Viewers cannot open configuration pages, so they see only the guides.
  const configurationItems = canConfigure
    ? [
        {
          title: "Shape your agent",
          description: "Edit its instructions, model, and tools.",
          link: defaultAgentLink(organizationSlug, defaultAgentId),
        },
        {
          title: "Connect model providers",
          description: "Add provider keys and choose the models your agents use.",
          link: linkOptions({ to: "/$orgSlug/models", params }),
        },
        {
          title: "Add a sandbox",
          description: "Let agents run code and work with files.",
          link: linkOptions({ to: "/$orgSlug/sandboxes", params }),
        },
        {
          title: "Connect MCP servers",
          description: "Give agents tools from external services.",
          link: linkOptions({ to: "/$orgSlug/mcp", params }),
        },
        {
          title: "Review usage limits",
          description: "Cap tokens or spend for your organization, customers, and users.",
          link: linkOptions({ to: "/$orgSlug/usage-limits", params }),
        },
      ]
    : []
  const inviteItems = canInvite
    ? [
        {
          title: "Invite teammates",
          description: "Add developers and viewers to this organization.",
          link: linkOptions({ to: "/$orgSlug/members", params }),
        },
      ]
    : []
  const items = [
    ...configurationItems,
    ...inviteItems,
    {
      title: "Match your brand",
      description: "Set the widget's title, colors, and theme.",
      link: { href: "/docs/sdk/theming" },
    },
    {
      title: "Add tools and widgets",
      description: "Let the assistant read and change your app's data.",
      link: { href: "/docs/sdk/tools-and-widgets" },
    },
  ]
  return (
    <div className="space-y-3">
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const content = (
            <>
              <span className="flex items-center justify-between gap-2 font-medium">
                {item.title}
                <ArrowRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              </span>
              <span className="text-muted-foreground">{item.description}</span>
            </>
          )
          const className =
            "flex h-full flex-col gap-1 border p-3 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          return (
            <li key={item.title}>
              {"href" in item.link ? (
                <Link
                  to={item.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                >
                  {content}
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>
              ) : (
                <Link {...item.link} className={className}>
                  {content}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      <DocsLink href="/docs/start/customize" className="text-sm">
        See every way to customize your setup
      </DocsLink>
    </div>
  )
}

export function DashboardIntegrationGuide({
  organizationId,
  organizationSlug,
  apiUrl,
  modelSetup,
  usableApiKeyCount,
  hasAppReply,
  markedSteps,
  permissions,
}: {
  organizationId: string
  organizationSlug: string
  apiUrl: string
  modelSetup: { defaultAgentModelCount: number; defaultAgentId: string | null } | null
  usableApiKeyCount: number | null
  hasAppReply: boolean | null
  markedSteps: ReadonlyArray<IntegrationGuideStep>
  permissions: Pick<
    OrganizationPermissions,
    "readConfiguration" | "updateConfiguration" | "createApiKey" | "readApiKey" | "createInvitation"
  >
}) {
  const router = useRouter()
  const titleId = useId()
  const [createApiKeyOpen, setCreateApiKeyOpen] = useState(false)
  const [promptCopyFailed, setPromptCopyFailed] = useState(false)
  const [pendingMarks, setPendingMarks] = useState<
    Partial<Record<IntegrationGuideStep, boolean | undefined>>
  >({})
  const [replied, setReplied] = useState(hasAppReply === true)
  const snippets = useMemo(() => integrationSnippets(apiUrl), [apiUrl])
  // Fixed at mount, so a reply detected here keeps the full guide and its success state visible.
  const [connectedOnLoad] = useState(hasAppReply === true)
  const waitingForReply = hasAppReply !== null && !replied

  async function saveMark(step: IntegrationGuideStep, marked: boolean) {
    setPendingMarks((pending) => ({ ...pending, [step]: marked }))
    try {
      await markIntegrationGuideStep({ data: { organizationSlug, step, marked } })
      await router.invalidate()
    } catch {
      toast.add({ title: "Couldn’t save your progress. Try again.", type: "error" })
    }
    setPendingMarks((pending) => ({ ...pending, [step]: undefined }))
  }

  function stepMark(step: IntegrationGuideStep) {
    return {
      marked: pendingMarks[step] ?? markedSteps.includes(step),
      onMarkedChange: permissions.updateConfiguration
        ? (marked: boolean) => void saveMark(step, marked)
        : undefined,
    }
  }

  useEffect(() => {
    if (!waitingForReply) return
    let active = true
    const poll = async () => {
      if (document.hidden) return
      const status = await getAppReplyStatus({ data: { organizationSlug } }).catch(() => false)
      if (!active || !status) return
      setReplied(true)
      toast.add({ title: "Your app received its first reply", type: "success" })
      void router.invalidate()
    }
    const interval = setInterval(() => void poll(), REPLY_POLL_INTERVAL_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [waitingForReply, organizationSlug, router])

  async function copySetupPrompt() {
    try {
      await navigator.clipboard.writeText(agentSetupPrompt)
      setPromptCopyFailed(false)
      toast.add({ title: "Prompt copied. Paste it into your coding agent.", type: "success" })
    } catch {
      setPromptCopyFailed(true)
    }
  }

  const defaultAgentId = modelSetup?.defaultAgentId ?? null
  const hasKey = usableApiKeyCount !== null && usableApiKeyCount > 0
  const customize = (
    <CustomizeLinks
      organizationSlug={organizationSlug}
      defaultAgentId={defaultAgentId}
      canConfigure={permissions.readConfiguration}
      canInvite={permissions.createInvitation}
    />
  )

  if (connectedOnLoad)
    return (
      <Card
        aria-labelledby={titleId}
        className="max-w-4xl text-sm sm:[--card-spacing:--spacing(6)]"
      >
        <CardHeader className="gap-2">
          <h2 id={titleId} className="flex items-center gap-2 font-sans text-sm font-medium">
            <CheckCircleIcon aria-hidden="true" weight="fill" className="size-5 text-primary" />
            Customize your setup
          </h2>
          <CardDescription className="text-sm">
            Your app is connected and your assistant is replying. Here’s what to tune next.
          </CardDescription>
        </CardHeader>
        <CardContent>{customize}</CardContent>
      </Card>
    )

  return (
    <>
      <Card
        aria-labelledby={titleId}
        className="max-w-4xl text-sm sm:[--card-spacing:--spacing(6)]"
      >
        <CardHeader className="gap-3">
          <h2 id={titleId} className="font-sans text-base font-semibold">
            Add the assistant to your app
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground">
            <span>Using a coding agent?</span>
            <Button variant="outline" size="sm" onClick={() => void copySetupPrompt()}>
              <CopyIcon aria-hidden="true" />
              Copy setup prompt
            </Button>
          </div>
          {promptCopyFailed && (
            <div className="space-y-2">
              <p role="status" className="text-muted-foreground">
                Clipboard access is unavailable. Copy the prompt below.
              </p>
              <Textarea
                aria-label="Integration prompt"
                readOnly
                value={agentSetupPrompt}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          )}
          {modelSetup?.defaultAgentModelCount === 0 && (
            <Alert className="text-sm">
              <WarningIcon aria-hidden="true" />
              <AlertTitle>Your default agent has no model</AlertTitle>
              <AlertDescription className="text-sm">
                {permissions.updateConfiguration ? (
                  <>
                    It can’t reply until you{" "}
                    <Link
                      {...defaultAgentLink(organizationSlug, defaultAgentId)}
                      className="font-medium text-primary underline underline-offset-4"
                    >
                      choose one
                    </Link>
                    .
                  </>
                ) : (
                  "It can’t reply until an owner or developer assigns one."
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardHeader>
        <CardContent>
          <ol>
            <GuideStep
              number={1}
              title="Create an API key"
              detected={hasKey}
              {...stepMark("api-key")}
            >
              <Note>
                Your server signs chat tokens with this key. Keep it out of browser code and version
                control.
              </Note>
              {permissions.createApiKey ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant={hasKey ? "outline" : "default"}
                    size="sm"
                    onClick={() => setCreateApiKeyOpen(true)}
                  >
                    <KeyIcon aria-hidden="true" />
                    {hasKey ? "Create another key" : "Create API key"}
                  </Button>
                  {hasKey && permissions.readApiKey && (
                    <span className="text-muted-foreground">
                      You have {usableApiKeyCount} active{" "}
                      <Link
                        to="/$orgSlug/api-keys"
                        params={{ orgSlug: organizationSlug }}
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        {usableApiKeyCount === 1 ? "key" : "keys"}
                      </Link>
                      .
                    </span>
                  )}
                </div>
              ) : (
                <Note>Ask an owner or developer of this organization for a key.</Note>
              )}
              <Note>Add the key to your server’s environment, then restart your server:</Note>
              <IntegrationCode markdown={snippets.environment} />
            </GuideStep>
            <GuideStep number={2} title="Install the SDK" {...stepMark("install")}>
              <IntegrationCode markdown={snippets.install} />
              <Note>
                Using Rails or a backend without a bundler? Skip this step and use the{" "}
                <strong>Script tag</strong> option in step 4.
              </Note>
            </GuideStep>
            <GuideStep number={3} title="Create the token endpoint" {...stepMark("endpoint")}>
              <Note>
                The widget calls <code className={inlineCode}>POST /api/astralbeam/token</code> to
                get a short-lived token for the signed-in user.
              </Note>
              <IntegrationCode markdown={snippets.endpoint} />
              <Note>
                Don’t use test IDs in production. Set <code className={inlineCode}>user.id</code>{" "}
                and <code className={inlineCode}>tenant.id</code> from your session, never the
                request body. <DocsLink href="/docs/sdk/authentication">Identify users</DocsLink>
              </Note>
            </GuideStep>
            <GuideStep number={4} title="Mount the chat widget" {...stepMark("mount")}>
              <Note>Render the widget in a container with a set height.</Note>
              <IntegrationCode markdown={snippets.mount} />
              <Note>
                Does your endpoint use another URL or headers, such as Rails’ CSRF token? Pass{" "}
                <code className={inlineCode}>fetchAstralBeamToken</code>.{" "}
                <DocsLink href="/docs/sdk/authentication#where-the-token-comes-from">
                  Customize token requests
                </DocsLink>
              </Note>
            </GuideStep>
            <GuideStep
              number={5}
              title="Send your first message"
              detected={replied}
              {...stepMark("reply")}
            >
              <Note>
                Open your app and send <strong>“Say hello in one sentence.”</strong> A reply should
                stream into the chat.
              </Note>
              {hasAppReply !== null && (
                <div
                  role="status"
                  className={cn(
                    "flex items-center gap-3 border p-3",
                    replied && "border-primary/40 bg-primary/5",
                  )}
                >
                  {replied ? (
                    <>
                      <CheckCircleIcon
                        aria-hidden="true"
                        weight="fill"
                        className="size-5 shrink-0 text-primary"
                      />
                      <span className="flex-1 font-medium">
                        Your assistant replied. Your app is connected!
                      </span>
                      <Link
                        to="/$orgSlug/threads"
                        params={{ orgSlug: organizationSlug }}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                      >
                        View conversation
                      </Link>
                    </>
                  ) : (
                    <>
                      <Spinner aria-hidden="true" className="size-4 shrink-0" />
                      <span className="flex-1">
                        Waiting for your first reply…{" "}
                        <span className="text-muted-foreground">This updates automatically.</span>
                      </span>
                    </>
                  )}
                </div>
              )}
            </GuideStep>
          </ol>
          <div className="mt-8 space-y-3 border-t pt-6">
            <h3 className="font-sans text-sm font-medium">Customize your setup</h3>
            {customize}
          </div>
        </CardContent>
      </Card>
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
