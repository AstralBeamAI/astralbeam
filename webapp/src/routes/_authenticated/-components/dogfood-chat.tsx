import { AstralBeamChat, type AstralBeamChatRef } from "@astralbeam/sdk/react"
import { ArrowCounterClockwiseIcon, ChatCircleIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useId, useRef, useState } from "react"
import { cn } from "cn"
import { useMatches } from "@tanstack/react-router"
import { useTheme } from "tanstack-router-theme-provider"

import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth/client"
import type { OrganizationAccess } from "@/lib/auth/organization-membership.server"
import { APP_NAME } from "@/lib/constants"

export function DogfoodChat() {
  const organization = useMatches({
    select: (matches) => {
      const dashboard = matches.find((match) => match.routeId === "/_authenticated/$orgSlug")
      if (dashboard) return dashboard.context.organization
      const settings = matches.find((match) => match.routeId === "/_authenticated/settings")
      return settings?.loaderData?.organization ?? null
    },
  })
  const { data: session } = authClient.useSession()
  if (!session || !organization) return null
  return (
    <DogfoodChatPanel
      key={`${session.user.id}:${organization.organizationId}`}
      organization={organization}
    />
  )
}

function DogfoodChatPanel({ organization }: { organization: OrganizationAccess }) {
  const { theme } = useTheme()
  const panelId = useId()
  const chat = useRef<AstralBeamChatRef>(null)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  useEffect(() => {
    if (!open) {
      if (hasOpened) trigger.current?.focus()
      return
    }
    closeButton.current?.focus()
    const element = panel.current!
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation()
        setOpen(false)
      }
    }
    element.addEventListener("keydown", onEscape)
    return () => element.removeEventListener("keydown", onEscape)
  }, [open, hasOpened])
  return (
    <>
      <Button
        ref={trigger}
        className={cn("fixed right-5 bottom-5 z-30 shadow-lg", open && "hidden")}
        aria-expanded={open}
        aria-controls={hasOpened ? panelId : undefined}
        onClick={() => {
          setHasOpened(true)
          setOpen(true)
        }}
      >
        <ChatCircleIcon aria-hidden="true" /> Ask {APP_NAME}
      </Button>
      {hasOpened && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={`Ask ${APP_NAME}`}
          data-dogfood-chat={open ? "open" : "closed"}
          className={cn(
            "fixed inset-0 z-30 flex h-dvh flex-col border-l bg-background lg:sticky lg:top-0 lg:w-[28rem] lg:shrink-0",
            !open && "hidden",
          )}
        >
          <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-medium">Ask {APP_NAME}</h2>
              <p
                className="truncate text-xs text-muted-foreground"
                title={organization.organizationName}
              >
                Assistant for {organization.organizationName}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Reset conversation"
              title="Reset conversation"
              onClick={() => chat.current?.reset()}
            >
              <ArrowCounterClockwiseIcon aria-hidden="true" />
            </Button>
            <Button
              ref={closeButton}
              variant="ghost"
              size="icon-sm"
              aria-label="Close chat"
              title="Close chat"
              onClick={() => setOpen(false)}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </header>
          <div className="min-h-0 flex-1">
            <AstralBeamChat
              ref={chat}
              apiUrl="/api"
              colorScheme={theme === "dark" || theme === "light" ? theme : "system"}
              showHeader={false}
              fetchAstralBeamToken={{
                url: "/api/astralbeam/token",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ organizationSlug: organization.organizationSlug }),
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}
