// Loaded eagerly by the client entry (and the React wrapper); keep this module
// tiny and free of chat-chunk imports so dist/client.js stays a small loader.

/** Endpoint the chat widget streams from when the mount options give none. */
export const DEFAULT_ENDPOINT = "/api/chat"

/** Color scheme used when the mount options and the React prop give none. */
export const DEFAULT_THEME = "system"
