import { CheckIcon, CopyIcon } from "@phosphor-icons/react"
import type { MarkdownComponentProps } from "@tanstack/markdown/react"
import { cn } from "cn"
import { useRef, useState } from "react"

import { buttonVariants } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function DocsCodeBlock({
  children,
  className,
  "data-code-title": title,
  "data-lang": language,
  ...props
}: MarkdownComponentProps<"pre"> & {
  "data-code-title"?: string
  "data-lang"?: string
}) {
  const codeRef = useRef<HTMLPreElement>(null)
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle")
  const label = status === "copied" ? "Copied to clipboard" : "Copy code"

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(codeRef.current?.textContent ?? "")
      setStatus("copied")
    } catch {
      setStatus("failed")
      codeRef.current?.focus()
      if (codeRef.current) {
        const range = document.createRange()
        range.selectNodeContents(codeRef.current)
        const selection = globalThis.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    }
  }

  return (
    <div className="my-4 min-w-0 overflow-hidden rounded-lg border">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b bg-muted/40 px-3 py-1">
        <span
          aria-hidden={Boolean(title)}
          className="min-w-0 break-all font-mono text-xs text-muted-foreground"
        >
          {title ?? language ?? "Code"}
        </span>
        <Tooltip>
          <TooltipTrigger
            type="button"
            aria-label={label}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            onClick={() => void copyCode()}
          >
            {status === "copied" ? (
              <CheckIcon aria-hidden="true" />
            ) : (
              <CopyIcon aria-hidden="true" />
            )}
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </div>
      <pre
        {...props}
        ref={codeRef}
        tabIndex={-1}
        aria-label={title ?? "Code example"}
        className={cn(
          "overflow-x-auto p-4 font-mono text-sm leading-relaxed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-sm",
          className,
        )}
      >
        {children}
      </pre>
      <p role="status" className={status === "failed" ? "border-t px-4 py-2 text-sm" : "sr-only"}>
        {status === "failed"
          ? "Couldn't copy automatically. Copy the selected code with your keyboard or browser menu."
          : status === "copied"
            ? "Copied to clipboard"
            : ""}
      </p>
    </div>
  )
}
