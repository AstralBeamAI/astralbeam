import {
  Markdown,
  type MarkdownComponentProps,
  type MarkdownComponents,
} from "@tanstack/markdown/react"
import { Link } from "@tanstack/react-router"
import { createElement, type ReactNode } from "react"

// Tailwind's preflight drops heading sizes, list markers, and block margins, so each element the
// renderer emits is restyled here rather than through a typography plugin.
const docsTagClasses: Record<string, string> = {
  p: "my-3 leading-7 first:mt-0 last:mb-0",
  h1: "mb-4 font-heading text-3xl font-semibold tracking-tight",
  h2: "mt-10 mb-3 border-b pb-2 font-heading text-xl font-semibold tracking-tight",
  h3: "mt-8 mb-2 font-heading text-lg font-semibold",
  h4: "mt-6 mb-2 font-heading text-base font-semibold",
  h5: "mt-6 mb-2 font-heading text-base font-medium",
  h6: "mt-6 mb-2 font-heading text-base font-medium",
  ul: "my-3 list-disc space-y-1.5 ps-6",
  ol: "my-3 list-decimal space-y-1.5 ps-6",
  li: "marker:text-muted-foreground [&>ol]:my-1 [&>ul]:my-1",
  blockquote: "my-3 border-s-2 ps-4 text-muted-foreground italic",
  code: "rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.85em]",
  // A fenced block nests a `code` element, whose chip styling is undone so only the block paints.
  pre:
    "my-4 overflow-x-auto rounded-lg border bg-muted/50 p-4 font-mono text-sm [&_code]:bg-transparent [&_code]:p-0",
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
    (props: { children?: ReactNode }) => createElement(tag, { ...props, className }),
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
export function DocsMarkdown(
  { markdown, sectionSlug }: { markdown: string; sectionSlug: string },
) {
  const components: MarkdownComponents = {
    ...docsStyledTags,
    table: DocsMarkdownTable,
    a: ({ href, children, ...props }: MarkdownComponentProps<"a">) => {
      const relative = href?.match(/^\.\/([\w-]+)\.md$/)
      if (relative) {
        return (
          <Link
            to="/docs/$section/$page"
            params={{ section: sectionSlug, page: relative[1]! }}
            className={docsLinkClass}
          >
            {children}
          </Link>
        )
      }
      return (
        <a
          {...props}
          href={href}
          className={docsLinkClass}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      )
    },
  }
  return <Markdown components={components}>{markdown}</Markdown>
}
