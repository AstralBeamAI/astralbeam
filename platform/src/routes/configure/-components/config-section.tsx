"use client"

import { CaretDownIcon, CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { type ReactNode, useId, useState } from "react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

export function ConfigSection({
  title,
  summary,
  configured,
  hasChanges = false,
  errorAttempt,
  children,
}: {
  title: string
  summary: string
  configured: boolean
  hasChanges?: boolean
  errorAttempt?: number | undefined
  children: ReactNode
}) {
  const id = useId()
  const [open, setOpen] = useState(!configured)
  const [previousErrorAttempt, setPreviousErrorAttempt] = useState(errorAttempt)
  // Reveal new save errors while allowing sections to be collapsed afterward.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (errorAttempt !== previousErrorAttempt) {
    setPreviousErrorAttempt(errorAttempt)
    if (errorAttempt !== undefined) setOpen(true)
  }
  const complete = configured && !hasChanges
  const status = hasChanges ? "Unsaved changes" : configured ? "Configured" : "Needs attention"
  const Icon = complete ? CheckCircleIcon : WarningCircleIcon

  return (
    <Collapsible
      render={<section aria-labelledby={`${id}-title`} />}
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-xl border bg-card text-card-foreground"
    >
      <h2>
        <CollapsibleTrigger
          aria-label={title}
          aria-describedby={`${id}-status${open ? "" : ` ${id}-summary`}`}
          className="group flex min-h-16 w-full items-start gap-3 p-5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <Icon
            aria-hidden="true"
            weight={complete ? "fill" : "regular"}
            className={`mt-0.5 size-6 shrink-0 ${complete ? "text-green-600 dark:text-green-400" : "text-warning"}`}
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
            {!open && (
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
        <div className="space-y-5 border-t p-5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
