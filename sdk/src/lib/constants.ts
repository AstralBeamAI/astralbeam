// Chat-chunk-only constants; anything the eager client entry needs lives in
// client-constants.ts so this module never enters dist/client.js.

// Client tools every chat mount declares to the agent: the endpoint forwards
// them verbatim and the chat widget executes them in the host page.
export const RENDER_WIDGET_TOOL = "render_widget"
export const ASK_QUESTIONNAIRE_TOOL = "ask_questionnaire"

// Renders are keyed per tool call so several can coexist, but they hold host DOM and host
// component state for the life of the conversation, so the oldest are evicted past this many.
export const MAX_ACTIVE_WIDGET_RENDERS = 20

/** Slot name prefix for widget renders; the bridged style rule keys off it. */
export const WIDGET_SLOT_PREFIX = "astralbeam-widget-"
export const WIDGET_SLOT_SELECTOR = `slot[name^="${WIDGET_SLOT_PREFIX}"]`

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
  // Non-standard but inherited
  "-webkit-text-fill-color",
  "-webkit-text-stroke-color",
  "-webkit-text-stroke-width",
  "-webkit-font-smoothing",
  "-webkit-tap-highlight-color",
]
