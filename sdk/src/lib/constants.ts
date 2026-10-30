// Loaded eagerly by the client entry (and the React wrapper); keep this module
// tiny and free of chat-chunk imports so dist/client.js stays a small loader.

/** Name shown in the widget's header when the mount options give none. */
export const DEFAULT_TITLE = "AstralBeam"

/** Headline of the empty transcript when the mount options give none. */
export const DEFAULT_EMPTY_HEADLINE = "Ask the assistant"

/** Subtitle of the empty transcript when the mount options give none. */
export const DEFAULT_EMPTY_DESCRIPTION =
  "Ask a question or describe what you want to do in this app."

/** Base URL of the AstralBeam API when the mount options give none; versioned routes hang off it. */
export const DEFAULT_API_URL = "https://astralbeam.ai/api"

/** Host endpoint that mints chat JWTs when the mount options give none. */
export const DEFAULT_CHAT_AUTH_TOKEN_URL = "/api/astralbeam/token"

/** Color scheme used when the mount options and the React prop give none. */
export const DEFAULT_COLOR_SCHEME = "system"

/**
 * Class on the widget container the loader creates. `src/styles.css` paints the palette through
 * it rather than through `:host`: the container is where `.dark` is toggled, so `:host` would
 * resolve `--background` from the light block in either theme. Keep the two in sync by hand.
 */
export const WIDGET_CONTAINER_CLASS = "astralbeam-root"

// Shared by the live widget and its inline loading shell.
export const CHAT_PANEL_CLASS_NAME =
  "relative flex h-full w-full flex-col gap-0 overflow-clip rounded-none bg-background py-0 text-sm text-foreground ring-0 [--card-spacing:--spacing(3)]"
export const CHAT_HEADER_CLASS_NAME =
  "flex h-14 shrink-0 items-center gap-1 border-b px-3 py-0 [.border-b]:pb-0"
export const CHAT_FOOTER_CLASS_NAME =
  "flex shrink-0 flex-col items-center gap-1 rounded-none border-t-0 bg-transparent px-3 pt-1 pb-2"
export const CHAT_INPUT_CLASS_NAME = "max-h-24 min-h-8 py-1.5 any-pointer-coarse:text-base"
export const CHAT_COMPOSER_SHORTCUT = "Enter to send, Shift+Enter for a new line."
