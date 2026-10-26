import type { MarkdownComponentProps } from "@tanstack/markdown/react"
import { Children, type ComponentProps, type ReactElement, useRef } from "react"

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import { toast } from "@/components/ui/toast"
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
  const code = Children.only(children) as ReactElement<ComponentProps<"code">>

  return (
    <CodeBlock className="my-4">
      <CodeBlockHeader>
        <CodeBlockTitle aria-hidden={Boolean(title)} className="font-mono">
          {title ?? language ?? "Code"}
        </CodeBlockTitle>
        <CodeBlockActions>
          <Tooltip>
            <TooltipTrigger
              render={
                <CodeBlockCopyButton
                  value={() => codeRef.current?.textContent ?? ""}
                  onCopyError={() => {
                    codeRef.current?.focus()
                    if (codeRef.current) {
                      globalThis.getSelection()?.selectAllChildren(codeRef.current)
                    }
                    toast.add({
                      title: "Couldn't copy. Copy the selected code manually.",
                      type: "error",
                    })
                  }}
                />
              }
            />
            <TooltipContent>Copy code</TooltipContent>
          </Tooltip>
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent
        {...props}
        ref={codeRef}
        role="region"
        aria-label={title ?? "Code example"}
        className={className}
      >
        <span {...code.props} />
      </CodeBlockContent>
    </CodeBlock>
  )
}
