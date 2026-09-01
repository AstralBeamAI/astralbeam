// Chat-chunk-only constants; anything the eager client entry needs lives in
// src/lib/constants.ts so this module never enters dist/client.js.

// Renders are keyed per tool call so several can coexist, but they hold host DOM and host
// component state for the life of the conversation, so the oldest are evicted past this many.
export const MAX_ACTIVE_WIDGET_RENDERS = 20

// Attachment limits and accepted types. The caps are per kind because the cost of a file to a
// run differs by kind: an image is billed as tokens by area, a PDF page by page, a text file by
// its characters. The endpoint enforces the same numbers, so a patched client gains nothing.
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
export const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024
export const MAX_ATTACHMENT_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  text: 1024 * 1024,
} as const

/** Image types the chat endpoint's model reads natively; SVG is text, so it is not one of them. */
export const ATTACHMENT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]

/** The one document type the model reads natively; every other document is read as text. */
export const ATTACHMENT_PDF_MIME_TYPE = "application/pdf"

// Types the endpoint decodes into text for the agent. `text/*` is covered by prefix, so this
// lists only the textual formats browsers label as `application/*` (plus SVG, which is markup).
export const ATTACHMENT_TEXT_MIME_TYPES = [
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-ndjson",
  "application/csv",
  "application/sql",
  "application/x-sh",
  "application/javascript",
  "application/typescript",
  "image/svg+xml",
]

// Browsers derive a file's type from its extension and get source files wrong: Chrome reports
// `.ts` as `video/mp2t` and leaves `.tsx`, `.rs`, and `.toml` empty. Extensions are therefore
// checked before the reported type, so a source file is never rejected as a video.
// https://developer.mozilla.org/en-US/docs/Web/API/File/type
export const ATTACHMENT_TEXT_EXTENSIONS = [
  "c",
  "cfg",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsonl",
  "jsx",
  "kt",
  "log",
  "lua",
  "md",
  "mdx",
  "mjs",
  "php",
  "pl",
  "py",
  "rb",
  "rs",
  "rst",
  "scss",
  "sh",
  "sql",
  "svg",
  "swift",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]

// Text files with no extension to go by, matched on the whole (lower-cased) filename. A picker
// `accept` list cannot express a bare filename, so these arrive by drop, paste, or the dialog's
// "All Files" mode; the endpoint's strict UTF-8 decode is what catches a binary named like one.
export const ATTACHMENT_TEXT_FILENAMES = [
  ".babelrc",
  ".bashrc",
  ".dockerignore",
  ".editorconfig",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".gitmodules",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  ".profile",
  ".zshrc",
  "authors",
  "changelog",
  "codeowners",
  "contributing",
  "dockerfile",
  "gemfile",
  "licence",
  "license",
  "makefile",
  "notice",
  "procfile",
  "rakefile",
  "readme",
]

/** Slot name prefix for widget renders; the bridged style rule keys off it. */
export const WIDGET_SLOT_PREFIX = "astralbeam-widget-"
export const HOST_SLOT_PREFIX = "astralbeam-slot-"
// One selector covers widget renders and chrome slots: both project host content that
// should read in the host page's own style.
export const WIDGET_SLOT_SELECTOR =
  `slot[name^="${WIDGET_SLOT_PREFIX}"], slot[name^="${HOST_SLOT_PREFIX}"]`

/**
 * Every inherited CSS property, bridged from the host page onto the widget slots. Longhands are
 * listed alongside the shorthands they replaced (`white-space`, `text-wrap`) so the set holds
 * across browser versions; an unsupported property reads back empty and is skipped. Aural
 * properties are omitted as they have no visual effect. Custom properties are inherited too, but
 * they are an open namespace, so their names are discovered from the page instead.
 * https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Inheritance
 */
export const INHERITED_PROPERTIES = [
  // Font
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-stretch",
  "font-size-adjust",
  "font-kerning",
  "font-optical-sizing",
  "font-feature-settings",
  "font-variation-settings",
  "font-language-override",
  "font-palette",
  "font-synthesis-weight",
  "font-synthesis-style",
  "font-synthesis-small-caps",
  "font-variant-alternates",
  "font-variant-caps",
  "font-variant-east-asian",
  "font-variant-emoji",
  "font-variant-ligatures",
  "font-variant-numeric",
  "font-variant-position",
  // Inline text
  "color",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "tab-size",
  "text-align",
  "text-align-last",
  "text-justify",
  "text-indent",
  "text-transform",
  "text-shadow",
  "text-rendering",
  "text-size-adjust",
  "text-underline-position",
  "text-underline-offset",
  "text-decoration-skip-ink",
  "text-emphasis-color",
  "text-emphasis-style",
  "text-emphasis-position",
  "white-space",
  "white-space-collapse",
  "text-wrap",
  "text-wrap-mode",
  "text-wrap-style",
  "word-break",
  "line-break",
  "overflow-wrap",
  "hyphens",
  "hyphenate-character",
  "hyphenate-limit-chars",
  "quotes",
  "orphans",
  "widows",
  // Writing mode
  "direction",
  "writing-mode",
  "text-orientation",
  "text-combine-upright",
  "ruby-align",
  "ruby-position",
  // Lists and tables
  "list-style-type",
  "list-style-position",
  "list-style-image",
  "border-collapse",
  "border-spacing",
  "caption-side",
  "empty-cells",
  // Color and interaction
  "color-scheme",
  "accent-color",
  "caret-color",
  "caret-shape",
  "cursor",
  "visibility",
  "pointer-events",
  "image-rendering",
  "image-orientation",
  "print-color-adjust",
  "forced-color-adjust",
  "scrollbar-color",
  // SVG presentation properties, for widgets that draw inline SVG
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "clip-rule",
  "color-interpolation",
  "color-interpolation-filters",
  "shape-rendering",
  "paint-order",
  "marker-start",
  "marker-mid",
  "marker-end",
  "dominant-baseline",
  "text-anchor",
  // Non-standard but inherited. -webkit-text-fill-color is deliberately absent: its computed
  // value is a concrete color that would beat `color` on every projected element, so
  // hostStyleRule pins it back to currentColor instead of bridging it.
  "-webkit-text-stroke-color",
  "-webkit-text-stroke-width",
  "-webkit-font-smoothing",
  "-webkit-tap-highlight-color",
]
