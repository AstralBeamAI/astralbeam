/** Endpoint the chat widget streams from when the mount options give none. */
export const DEFAULT_ENDPOINT = "/api/chat"

// Client tools every chat mount declares to the agent: the endpoint forwards
// them verbatim and the chat widget executes them in the host page.
export const RENDER_WIDGET_TOOL = "render_widget"
export const ASK_QUESTIONNAIRE_TOOL = "ask_questionnaire"
