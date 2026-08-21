// Chat-chunk-only constants; anything the eager client entry needs lives in
// client-constants.ts so this module never enters dist/client.js.

// Client tools every chat mount declares to the agent: the endpoint forwards
// them verbatim and the chat widget executes them in the host page.
export const RENDER_WIDGET_TOOL = "render_widget"
export const ASK_QUESTIONNAIRE_TOOL = "ask_questionnaire"
