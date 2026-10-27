import { cn } from "cn"
import stripAnsi from "strip-ansi"
import { useMemo } from "react"
import { highlightCode } from "../lib/highlighter"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "./ui/code-block"

interface HighlightedCodeProps {
  children: string
  language?: string | undefined
  title?: string | undefined
  wrap?: boolean | undefined
  tone?: "default" | "error" | undefined
  className?: string | undefined
}

export function HighlightedCode({
  children,
  language = "text",
  title,
  wrap = false,
  tone = "default",
  className,
}: HighlightedCodeProps) {
  const code = language.toLowerCase() === "ansi" ? stripAnsi(children) : children
  const lines = useMemo(() => highlightCode(code, language), [code, language])
  return (
    <CodeBlock size="sm" variant={tone === "error" ? "destructive" : "default"}>
      <CodeBlockHeader className="group-data-[size=sm]/code-block:pt-2">
        <CodeBlockTitle title={title} className="text-muted-foreground">
          {title ?? language}
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} className="any-pointer-coarse:size-11" />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent
        wrap={wrap}
        className={cn(
          "max-h-72 whitespace-pre group-data-[size=sm]/code-block:py-2 group-data-[size=sm]/code-block:group-has-data-[slot=code-block-header]/code-block:pt-1",
          className,
        )}
      >
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}
