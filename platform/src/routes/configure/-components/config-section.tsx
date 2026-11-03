"use client"

import { CaretDownIcon, CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { type ReactNode, useId, useState } from "react"

import { DocsLink } from "@/components/docs-link"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

export function ConfigSection({
  title,
  documentationHref,
  summary,
  configured,
  id: sectionId,
  configuredLabel = "Settings present",
  defaultOpen = false,
  optional = false,
  hasChanges = false,
  errorAttempt,
  children,
}: {
  title: string
  documentationHref: string
  summary: string
  configured: boolean
  id: string
  configuredLabel?: string
  defaultOpen?: boolean
  optional?: boolean
  hasChanges?: boolean
  errorAttempt?: number | undefined
  children: ReactNode
}) {
  const id = useId()
  const hash = useLocation({ select: (location) => location.hash })
  const navigate = useNavigate()
  const [open, setOpen] = useState(defaultOpen)
  const expanded = open || hash === sectionId
  const [previousErrorAttempt, setPreviousErrorAttempt] = useState(errorAttempt)
  // Reveal new save errors while allowing sections to be collapsed afterward.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (errorAttempt !== previousErrorAttempt) {
    setPreviousErrorAttempt(errorAttempt)
    if (errorAttempt !== undefined) setOpen(true)
  }
  const complete = configured && !hasChanges
  const status = hasChanges
    ? "Unsaved changes"
    : !configured
      ? "Needs attention"
      : optional
        ? "Optional"
        : configuredLabel
  const Icon = complete ? CheckCircleIcon : WarningCircleIcon

  return (
    <Collapsible
      render={<section id={sectionId} aria-labelledby={`${id}-title`} />}
      open={expanded}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen && hash === sectionId)
          void navigate({ to: "/configure", hash: "", replace: true })
      }}
      className="scroll-mt-24 overflow-hidden rounded-xl border bg-card text-card-foreground"
    >
      <h2>
        <CollapsibleTrigger
          aria-label={title}
          aria-describedby={`${id}-status${expanded ? "" : ` ${id}-summary`}`}
          className="group flex min-h-16 w-full items-start gap-3 p-5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <Icon
            aria-hidden="true"
            weight={complete ? "fill" : "regular"}
            className={`mt-0.5 size-6 shrink-0 ${complete ? "text-primary" : "text-warning"}`}
          />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span id={`${id}-title`} className="text-base font-semibold">
                {title}
              </span>
              <span id={`${id}-status`} className="text-xs font-medium text-muted-foreground">
                {status}
              </span>
            </span>
            {!expanded && (
              <span
                id={`${id}-summary`}
                className="block text-sm font-normal break-words text-muted-foreground"
              >
                {summary}
              </span>
            )}
          </span>
          <CaretDownIcon
            aria-hidden="true"
            className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180"
          />
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent keepMounted>
        <div className="space-y-5 border-t p-5">
          <p className="text-sm text-muted-foreground">
            <DocsLink href={documentationHref}>{title} setup guide</DocsLink>
          </p>
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
