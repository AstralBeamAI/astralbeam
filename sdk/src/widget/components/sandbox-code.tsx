import { cn } from "../lib/utils.ts"

interface SandboxCodeBlockProps {
  children: string
  /** Error output, which reads as the reason a command failed rather than as its result. */
  tone?: "default" | "error"
  /** Shown in place of the block when there is nothing to show. */
  emptyLabel?: string
  /** One muted line above the block, for the detail a row's label had to leave out. */
  caption?: string | undefined
}

/**
 * A file or a command's output, verbatim. `whitespace-pre` with horizontal scrolling rather than
 * wrapping: a wrapped line of code or of a stack trace is harder to read than a scrolled one, and
 * Tailwind's preflight does not preserve the browser's own `pre` white-space handling here.
 */
export function SandboxCodeBlock(
  { children, tone = "default", emptyLabel, caption }: SandboxCodeBlockProps,
) {
  const captionLine = caption === undefined
    ? null
    : <p className="mb-1 font-mono text-xs text-muted-foreground wrap-anywhere">{caption}</p>
  if (children.length === 0 && emptyLabel) {
    return (
      <>
        {captionLine}
        <p className="text-xs text-muted-foreground italic">{emptyLabel}</p>
      </>
    )
  }
  return (
    <>
      {captionLine}
      <pre
        className={cn(
          "max-h-72 overflow-auto rounded-md border border-border bg-muted p-2 font-mono text-xs leading-relaxed whitespace-pre",
          tone === "error" && "text-destructive",
        )}
      >
        <code>{children}</code>
      </pre>
    </>
  )
}
