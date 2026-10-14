import { cn } from "cn"
import { useHighlightedCode } from "../hooks/use-highlighted-code"
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
  const lines = useHighlightedCode(children, language)
  return (
    <CodeBlock size="sm" variant={tone === "error" ? "destructive" : "default"}>
      <CodeBlockHeader>
        <CodeBlockTitle title={title} className="text-muted-foreground">
          {title ?? language}
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={children} className="any-pointer-coarse:size-11" />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap={wrap} className={cn("max-h-72 whitespace-pre", className)}>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}
