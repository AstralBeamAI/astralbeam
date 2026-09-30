import { AstralBeamChat, type AstralBeamChatRef } from "@astralbeam/sdk/react"
import { ArrowCounterClockwiseIcon, SparkleIcon, XIcon } from "@phosphor-icons/react"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { cn } from "cn"
import { getRouteApi, useMatches } from "@tanstack/react-router"
import { useTheme } from "tanstack-router-theme-provider"

import { Button } from "@/components/ui/button"

import type { OrganizationAccess } from "@/lib/organizations/access"
import { ASSISTANT_NAME } from "@/lib/constants"
import { widgetDashboardTheme, widgetThemeClassName, widgetThemeStyle } from "../-lib/widget-theme"

const dogfoodChatRoute = getRouteApi("/_authenticated")

type DogfoodChatState = {
  panelId: string
  triggerId: string
  open: boolean
  hasOpened: boolean
  setOpen: (open: boolean) => void
}

const DogfoodChatContext = createContext<DogfoodChatState | null>(null)

/** Renders the chat panel beside `children`, whose header shows `DogfoodChatTrigger`. */
export function DogfoodChat({ children }: { children: ReactNode }) {
  const organization = useMatches({
    select: (matches) => {
      const dashboard = matches.find((match) => match.routeId === "/_authenticated/$orgSlug")
      if (dashboard) return dashboard.context.organization
      const userPage = matches.find(
        (match) =>
          match.routeId === "/_authenticated/settings" ||
          match.routeId === "/_authenticated/organizations/",
      )
      return userPage?.loaderData?.organization ?? null
    },
  })
  const { access } = dogfoodChatRoute.useRouteContext()
  const panelId = useId()
  const triggerId = useId()
  const [open, setOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  if (open && !hasOpened) setHasOpened(true)
  const chatKey = organization ? `${access.userId}:${organization.organizationId}` : null
  // Another user or organization closes the chat and defers its token request until reopened.
  const [previousChatKey, setPreviousChatKey] = useState(chatKey)
  if (chatKey !== previousChatKey) {
    setPreviousChatKey(chatKey)
    setOpen(false)
    setHasOpened(false)
  }
  const chat: DogfoodChatState = { panelId, triggerId, open, hasOpened, setOpen }
  return (
    <DogfoodChatContext.Provider value={organization ? chat : null}>
      {children}
      {organization && hasOpened && (
        <DogfoodChatPanel key={chatKey} organization={organization} chat={chat} />
      )}
    </DogfoodChatContext.Provider>
  )
}

export function DogfoodChatTrigger({ className }: { className?: string }) {
  const chat = useContext(DogfoodChatContext)
  // The open panel's header already closes it, so the trigger only offers to open.
  if (!chat || chat.open) return null
  return (
    <Button
      id={chat.triggerId}
      size="sm"
      className={className}
      aria-controls={chat.hasOpened ? chat.panelId : undefined}
      onClick={() => chat.setOpen(true)}
    >
      <SparkleIcon aria-hidden="true" weight="fill" /> Ask {ASSISTANT_NAME}
    </Button>
  )
}

function DogfoodChatPanel({
  organization,
  chat: { panelId, triggerId, open, setOpen },
}: {
  organization: OrganizationAccess
  chat: DogfoodChatState
}) {
  const { theme } = useTheme()
  const chat = useRef<AstralBeamChatRef>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) {
      document.getElementById(triggerId)?.focus()
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
  }, [open, setOpen, triggerId])
  return (
    <div
      ref={panel}
      id={panelId}
      role="dialog"
      aria-label={`Ask ${ASSISTANT_NAME}`}
      data-dogfood-chat={open ? "open" : "closed"}
      className={cn(
        "fixed inset-0 z-30 flex h-dvh flex-col border-l bg-background lg:sticky lg:top-0 lg:w-[28rem] lg:shrink-0",
        !open && "hidden",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">Ask {ASSISTANT_NAME}</h2>
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
      <div className={cn("min-h-0 flex-1", widgetThemeClassName)} style={widgetThemeStyle}>
        <AstralBeamChat
          ref={chat}
          apiUrl="/api"
          colorScheme={theme === "dark" || theme === "light" ? theme : "system"}
          showHeader={false}
          title={ASSISTANT_NAME}
          theme={widgetDashboardTheme}
          fetchAstralBeamToken={{
            url: "/api/astralbeam/token",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ organizationSlug: organization.organizationSlug }),
          }}
        />
      </div>
    </div>
  )
}
