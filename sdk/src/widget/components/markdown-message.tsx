import { streamingMarkdownExtension } from "@tanstack/markdown/extensions/streaming"
import {
  Markdown,
  type MarkdownComponentProps,
  type MarkdownComponents,
} from "@tanstack/markdown/react"
import {
  Children,
  createContext,
  createElement,
  isValidElement,
  useContext,
  type ReactNode,
} from "react"
import { safeWebUrl, type WebCitation } from "../../core/web.ts"
import { HighlightedCode } from "./highlighted-code.tsx"
import { InlineCitation } from "./inline-citation.tsx"

// The extension is stateless, so one instance serves every render; a fresh array would also
// change the render options' identity on each chunk of a streamed reply.
const extensions = [streamingMarkdownExtension()]
const CitationContext = createContext<readonly WebCitation[]>([])

// Tailwind's preflight drops heading sizes, list markers, and block margins, so each element the
// renderer emits is restyled here rather than through a typography plugin.
const tagClasses: Record<string, string> = {
  p: "my-2 first:mt-0 last:mb-0",
  h1: "mt-4 mb-2 font-heading text-base font-semibold first:mt-0",
  h2: "mt-4 mb-2 font-heading text-base font-medium first:mt-0",
  h3: "mt-3 mb-1.5 font-heading text-sm font-semibold first:mt-0",
  h4: "mt-3 mb-1.5 font-heading text-sm font-medium first:mt-0",
  h5: "mt-3 mb-1.5 font-heading text-sm font-medium first:mt-0",
  h6: "mt-3 mb-1.5 font-heading text-sm font-medium first:mt-0",
  ul: "my-2 list-disc space-y-1 ps-5 first:mt-0 last:mb-0",
  ol: "my-2 list-decimal space-y-1 ps-5 first:mt-0 last:mb-0",
  li: "marker:text-muted-foreground [&>ol]:my-1 [&>ul]:my-1",
  blockquote: "my-2 border-s-2 ps-3 text-muted-foreground italic",
  code: "rounded-sm bg-muted px-1 py-0.5 font-mono text-xs",
  hr: "my-3",
  thead: "border-b",
  th: "px-2 py-1 text-start font-medium",
  td: "border-t px-2 py-1",
  strong: "font-medium",
  del: "line-through",
  sup: "text-[0.7em]",
  // Footnote definitions the parser appends below the reply.
  section: "mt-3 border-t pt-2 text-xs text-muted-foreground",
}

const styledTags = Object.fromEntries(
  Object.entries(tagClasses).map(([tag, className]) => [
    tag,
    (props: { children?: ReactNode }) => createElement(tag, { ...props, className }),
  ]),
)

// Executable protocols are stripped by the parser; an outbound link still opens away from the
// host page and carries no referrer or ranking signal, since the agent chose it.
function MarkdownLink({ href, children, title, ...props }: MarkdownComponentProps<"a">) {
  const citations = useContext(CitationContext)
  const labels = Children.toArray(children)
  const citation = citations.find(
    (source) =>
      labels.length === 1 &&
      String(source.number) === labels[0] &&
      source.title.replaceAll(/\s+/g, " ") === title &&
      safeWebUrl(source.url) === href,
  )
  if (citation && href) return <InlineCitation citation={citation} href={href} />
  const external = /^https?:\/\//i.test(href ?? "")
  return (
    <a
      {...props}
      href={href}
      title={title}
      className="font-medium underline underline-offset-2"
      {...(external
        ? { target: "_blank", rel: "nofollow noopener noreferrer", referrerPolicy: "no-referrer" }
        : {})}
    >
      {children}
    </a>
  )
}

function MarkdownCodeBlock({ children, ...props }: MarkdownComponentProps<"pre">) {
  const child = Children.only(children)
  const code = isValidElement<{ children: string }>(child) ? child.props.children : ""
  const language = (props as Record<string, unknown>)["data-lang"]
  return (
    <div className="my-2">
      <HighlightedCode language={typeof language === "string" ? language : undefined}>
        {code}
      </HighlightedCode>
    </div>
  )
}

function MarkdownImage({ alt, ...props }: MarkdownComponentProps<"img">) {
  return (
    <img
      {...props}
      alt={alt ?? ""}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="my-2 max-w-full rounded-md"
    />
  )
}

// The bubble clips its overflow, so a table wider than the widget scrolls in its own container.
function MarkdownTable(props: MarkdownComponentProps<"table">) {
  return (
    <div className="my-2 overflow-x-auto">
      <table {...props} className="w-full border-collapse text-xs" />
    </div>
  )
}

const components: MarkdownComponents = {
  ...styledTags,
  a: MarkdownLink,
  img: MarkdownImage,
  table: MarkdownTable,
  pre: MarkdownCodeBlock,
}

/**
 * Renders an assistant reply's Markdown. Safe for a partial reply: the streaming profile reparses
 * the accumulated text on every chunk and holds back incomplete trailing blocks.
 */
export function MarkdownMessage({
  children,
  citations = [],
}: {
  children: string
  citations?: readonly WebCitation[] | undefined
}) {
  // Frontmatter is off so a `---` completing mid-reply cannot reinterpret its opening as metadata,
  // and heading ids are off so a growing heading does not churn its id. Raw HTML stays escaped.
  return (
    <CitationContext.Provider value={citations}>
      <Markdown
        extensions={extensions}
        components={components}
        frontmatter={false}
        headingIds={false}
      >
        {children}
      </Markdown>
    </CitationContext.Provider>
  )
}
