import { HighlightedCode } from "./highlighted-code.tsx"

interface SandboxCodeBlockProps {
  children: string
  /** Error output, which reads as the reason a command failed rather than as its result. */
  tone?: "default" | "error"
  /** Shown in place of the block when there is nothing to show. */
  emptyLabel?: string
  /** The block title, for the detail a row's label had to leave out. */
  caption?: string | undefined
  language?: string | undefined
}

export function SandboxCodeBlock({
  children,
  tone = "default",
  emptyLabel,
  caption,
  language,
}: SandboxCodeBlockProps) {
  const captionLine =
    caption === undefined ? null : (
      <p className="mb-1 font-mono text-xs text-muted-foreground wrap-anywhere">{caption}</p>
    )
  if (children.length === 0 && emptyLabel) {
    return (
      <>
        {captionLine}
        <p className="text-xs text-muted-foreground italic">{emptyLabel}</p>
      </>
    )
  }
  return (
    <HighlightedCode title={caption} language={language} tone={tone}>
      {children}
    </HighlightedCode>
  )
}
