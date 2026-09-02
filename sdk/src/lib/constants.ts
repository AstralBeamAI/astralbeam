// Loaded eagerly by the client entry (and the React wrapper); keep this module
// tiny and free of chat-chunk imports so dist/client.js stays a small loader.

/** Name shown in the widget's header when the mount options give none. */
export const DEFAULT_TITLE = "AstralBeam"

/** Headline of the empty transcript when the mount options give none. */
export const DEFAULT_EMPTY_TITLE = "Ask the assistant"

/** Subtitle of the empty transcript when the mount options give none. */
export const DEFAULT_EMPTY_DESCRIPTION =
  "It can answer questions and act through this app's own tools and widgets."

/** Base URL of the AstralBeam API when the mount options give none; `/chat` and its subroutes hang off it. */
export const DEFAULT_API_URL = "https://app.astralbeam.ai/api"

/** Host endpoint that mints chat JWTs when the mount options give none. */
export const DEFAULT_AUTH_TOKEN_URL = "/api/astralbeam/token"

/**
 * The chat API's URLs under an API base: the stream itself, the agent capability handshake,
 * and artifact downloads. Chat is one API under the base; others will sit beside it.
 */
export function chatApiUrls(apiUrl: string | undefined): {
  chat: string
  config: string
  files: string
} {
  const chat = `${(apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "")}/chat`
  return { chat, config: `${chat}/config`, files: `${chat}/files` }
}

/** Color scheme used when the mount options and the React prop give none. */
export const DEFAULT_COLOR_SCHEME = "system"

/**
 * Class on the widget container the loader creates. `src/styles.css` paints the palette through
 * it rather than through `:host`: the container is where `.dark` is toggled, so `:host` would
 * resolve `--background` from the light block in either theme. Keep the two in sync by hand.
 */
export const WIDGET_CONTAINER_CLASS = "astralbeam-root"
