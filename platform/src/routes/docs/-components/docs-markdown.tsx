import {
  Markdown,
  type MarkdownComponentProps,
  type MarkdownComponents,
} from "@tanstack/markdown/react"
import { Link } from "@tanstack/react-router"
import type { MarkdownInput } from "@tanstack/markdown"
import { cn } from "cn"
import { createElement, type ReactNode } from "react"
import { TabsContent } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"

import { docsHighlightMarkdownCode } from "../-lib/highlight"
import { DocsCodeBlock } from "./docs-code-block"
import { DocsCodeTabs } from "./docs-code-tabs"

// Tailwind's preflight drops heading sizes, list markers, and block margins, so each element the
// renderer emits is restyled here rather than through a typography plugin.
const docsTagClasses: Record<string, string> = {
  p: "my-3 leading-7 first:mt-0 last:mb-0",
  h1: "mb-4 font-heading text-3xl font-semibold tracking-tight",
  h2: "mt-10 mb-3 scroll-mt-20 border-b pb-2 font-heading text-xl font-semibold tracking-tight",
  h3: "mt-8 mb-2 scroll-mt-20 font-heading text-lg font-semibold",
  h4: "mt-6 mb-2 font-heading text-base font-semibold",
  h5: "mt-6 mb-2 font-heading text-base font-medium",
  h6: "mt-6 mb-2 font-heading text-base font-medium",
  ul: "my-3 list-disc space-y-1.5 ps-6",
  ol: "my-3 list-decimal space-y-1.5 ps-6",
  li: "marker:text-muted-foreground [&>ol]:my-1 [&>ul]:my-1",
  blockquote: "my-3 border-s-2 ps-4 text-muted-foreground italic",
  code: "rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.85em]",
  figcaption: "sr-only",
  img: "my-6 h-auto max-w-full rounded-lg border",
  hr: "my-6",
  thead: "border-b",
  th: "px-3 py-2 text-start font-medium",
  td: "border-t px-3 py-2",
  strong: "font-medium",
  del: "line-through",
}

const docsStyledTags = Object.fromEntries(
  Object.entries(docsTagClasses).map(([tag, className]) => [
    tag,
    ({ className: extraClassName, ...props }: { children?: ReactNode; className?: string }) =>
      createElement(tag, { ...props, className: cn(className, extraClassName) }),
  ]),
)

const docsLinkClass = "font-medium text-primary underline underline-offset-4"

function DocsMarkdownTable(props: MarkdownComponentProps<"table">) {
  return (
    <div className="my-4 overflow-x-auto rounded-lg border">
      <table {...props} className="w-full border-collapse text-sm" />
    </div>
  )
}

/**
 * Renders one docs page. Same-folder `./page.md` links, the form the Markdown sources use so
 * they stay readable on GitHub, are routed to the page's docs URL instead.
 */
export function DocsMarkdown({
  markdown,
  sectionSlug,
}: {
  markdown: MarkdownInput
  sectionSlug: string
}) {
  const components: MarkdownComponents = {
    ...docsStyledTags,
    img: ({ className, ...props }) => (
      <img
        {...props}
        alt={props.alt ?? ""}
        {...(props.src === "/docs/quickstart-preview.png" ? { width: 900, height: 360 } : {})}
        className={cn(docsTagClasses.img, className)}
      />
    ),
    pre: DocsCodeBlock,
    "md-comment-component": DocsCodeTabs,
    "md-tab-panel": ({ children, "data-tab-slug": slug }) => (
      <TabsContent value={slug} className="min-w-0 [&>figure>div]:mt-2">
        {children}
      </TabsContent>
    ),
    table: DocsMarkdownTable,
    a: ({ href, children, ...props }: MarkdownComponentProps<"a">) => {
      const relative = href?.match(/^\.\/([\w-]+)\.md(?:#(.*))?$/)
      if (relative) {
        return (
          <Link
            to="/docs/$section/$page"
            params={{ section: sectionSlug, page: relative[1]! }}
            hash={relative[2] ?? ""}
            title={props.title}
            className={docsLinkClass}
          >
            {children}
          </Link>
        )
      }
      const external = props.download === undefined && /^(?:https?:)?\/\//i.test(href ?? "")
      return (
        <a
          {...props}
          href={href}
          className={docsLinkClass}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
        >
          {children}
        </a>
      )
    },
  }
  return (
    <TooltipProvider>
      <div className="docs-markdown">
        <Markdown components={components} highlighter={docsHighlightMarkdownCode}>
          {markdown}
        </Markdown>
      </div>
    </TooltipProvider>
  )
}
