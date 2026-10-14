// Added with: deno task ui add use-highlighted-code
// Local changes: lazy-load the highlighter and preserve ANSI state across lines.
import * as React from "react"

import type { loadHighlighter } from "@/widget/components/ui/highlighter"

export function useHighlightedCode(value: string, language: string) {
  // A trailing newline would render as an extra empty line.
  const code = value.endsWith("\n") ? value.slice(0, -1) : value
  const [loaded, setLoaded] = React.useState<{
    language: string
    highlighter: Awaited<ReturnType<typeof loadHighlighter>>
  } | null>(null)
  const highlighter = loaded?.language === language ? loaded.highlighter : null

  React.useEffect(() => {
    let cancelled = false

    import("@/widget/components/ui/highlighter")
      .then(({ loadHighlighter }) => loadHighlighter(language))
      .then((next) => {
        if (!cancelled) {
          setLoaded({ language, highlighter: next })
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [language])

  // The complete lines, highlighted. While the code streams, only the new
  // lines are tokenized, starting from the grammar state of the last one.
  const [done, setDone] = React.useState<{
    highlighter: typeof highlighter
    text: string
    lines: React.ReactNode[]
    state?: Parameters<NonNullable<typeof highlighter>["highlight"]>[1]
  }>({ highlighter: null, text: "", lines: [] })

  let next = done

  if (next.highlighter !== highlighter || !code.startsWith(next.text)) {
    next = { highlighter, text: "", lines: [] }
  }

  // ANSI has no grammar state, so tokenize the whole block to retain its styles.
  const end = language.toLowerCase() === "ansi" ? 0 : code.lastIndexOf("\n") + 1

  if (highlighter && end > next.text.length) {
    const result = highlighter.highlight(
      code.slice(next.text.length, end - 1),
      next.state
    )

    next = {
      highlighter,
      text: code.slice(0, end),
      lines: [...next.lines, ...result.lines],
      state: result.state,
    }
  }

  if (next !== done) {
    setDone(next)
  }

  // Re-tokenize the unfinished last line, or the full block for ANSI output.
  const tail = code.slice(end)

  return React.useMemo(() => {
    if (!highlighter) {
      return code.split("\n")
    }

    return [...next.lines, ...highlighter.highlight(tail, next.state).lines]
  }, [code, highlighter, next, tail])
}
