import { createHighlighter } from "@tanstack/highlight/core"
import { env } from "@tanstack/highlight/languages/env"
import { json } from "@tanstack/highlight/languages/json"
import { nginx } from "@tanstack/highlight/languages/nginx"
import { plaintext } from "@tanstack/highlight/languages/plaintext"
import { shell } from "@tanstack/highlight/languages/shell"
import { ts } from "@tanstack/highlight/languages/ts"
import { tsx } from "@tanstack/highlight/languages/tsx"
import { createTanStackMarkdownHighlighter } from "@tanstack/highlight/markdown"
import { createThemeCss } from "@tanstack/highlight/theme"
import { githubDarkTheme } from "@tanstack/highlight/themes/github-dark"
import { githubLightTheme } from "@tanstack/highlight/themes/github-light"

const docsHighlighter = createHighlighter({
  languages: [plaintext, ts, tsx, json, shell, nginx, env],
})

export const docsHighlightMarkdownCode = createTanStackMarkdownHighlighter(docsHighlighter)

export const docsHighlightCss = createThemeCss({
  light: githubLightTheme,
  dark: githubDarkTheme,
  lightSelector: ".docs-markdown",
  darkSelector: ".dark .docs-markdown",
  codeBlockSelector: ".docs-markdown pre.tm-code",
  lineNumbersSelector: ".docs-markdown .tm-code--line-numbers",
})
