import { createHighlighter } from "@tanstack/highlight/core"
import { css } from "@tanstack/highlight/languages/css"
import { diff } from "@tanstack/highlight/languages/diff"
import { html } from "@tanstack/highlight/languages/html"
import { js } from "@tanstack/highlight/languages/js"
import { json } from "@tanstack/highlight/languages/json"
import { jsx } from "@tanstack/highlight/languages/jsx"
import { markdown } from "@tanstack/highlight/languages/markdown"
import { plaintext } from "@tanstack/highlight/languages/plaintext"
import { python } from "@tanstack/highlight/languages/python"
import { ruby } from "@tanstack/highlight/languages/ruby"
import { shell } from "@tanstack/highlight/languages/shell"
import { sql } from "@tanstack/highlight/languages/sql"
import { ts } from "@tanstack/highlight/languages/ts"
import { tsx } from "@tanstack/highlight/languages/tsx"
import { yaml } from "@tanstack/highlight/languages/yaml"
import type { ReactNode } from "react"

const highlighter = createHighlighter({
  languages: [
    css,
    diff,
    html,
    js,
    json,
    jsx,
    markdown,
    plaintext,
    python,
    ruby,
    shell,
    sql,
    ts,
    tsx,
    yaml,
  ],
})

export function highlightCode(value: string, language: string): ReactNode[][] {
  // Keep the existing code-block layout without an extra line for a final newline.
  const code = value.replace(/\r?\n$/, "")
  const lang = language.toLowerCase() === "shellscript" ? "shell" : language.toLowerCase()
  const { tokens } = highlighter.tokenize(code, { lang })
  const lines: ReactNode[][] = [[]]
  for (const [index, token] of tokens.entries()) {
    for (const [part, text] of token.value.split(/\r?\n/).entries()) {
      if (part) lines.push([])
      if (text) {
        lines[lines.length - 1]!.push(
          <span
            key={`${index}-${part}`}
            className={token.className ? `th-${token.className}` : undefined}
          >
            {text}
          </span>,
        )
      }
    }
  }
  return lines
}
