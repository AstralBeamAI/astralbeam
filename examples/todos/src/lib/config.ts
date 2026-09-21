export const APP_NAME = "AstralBeam Todos"
export const CHAT_TITLE = "Todos assistant"
// Overridable so the end-to-end suite can point at a webapp it started on its own port.
export const ASTRALBEAM_API_URL = import.meta.env.VITE_ASTRALBEAM_API_URL ||
  "http://localhost:4500/api"
// Left undefined when unset so the widget falls back to the organization's default agent.
export const CHAT_AGENT_ID: string | undefined = import.meta.env.VITE_ASTRALBEAM_AGENT_ID ||
  undefined
