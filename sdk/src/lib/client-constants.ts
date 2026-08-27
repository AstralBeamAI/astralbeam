// Loaded eagerly by the client entry (and the React wrapper); keep this module
// tiny and free of chat-chunk imports so dist/client.js stays a small loader.

/** Name shown in the widget's header when the mount options give none. */
export const DEFAULT_TITLE = "AstralBeam"

/** Headline of the empty transcript when the mount options give none. */
export const DEFAULT_EMPTY_TITLE = "Ask the assistant"

/** Subtitle of the empty transcript when the mount options give none. */
export const DEFAULT_EMPTY_DESCRIPTION =
  "It can answer questions and act through this app's own tools and widgets."

/** Endpoint the chat widget streams from when the mount options give none. */
export const DEFAULT_ENDPOINT = "/api/chat"

/** Color scheme used when the mount options and the React prop give none. */
export const DEFAULT_COLOR_SCHEME = "system"

/**
 * Class on the widget container the loader creates. `src/styles.css` paints the palette through
 * it rather than through `:host`: the container is where `.dark` is toggled, so `:host` would
 * resolve `--background` from the light block in either theme. Keep the two in sync by hand.
 */
export const WIDGET_CONTAINER_CLASS = "astralbeam-root"
