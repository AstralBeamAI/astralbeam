export const APP_NAME = "AstralBeam Todos"
export const CHAT_TITLE = "Todos assistant"
export const CHAT_ENDPOINT = "http://localhost:3000/api/chat"
export const CHAT_AUTH_ENDPOINT = "/api/chat/token"
// Left undefined when unset so the widget falls back to the organization's default agent.
export const CHAT_AGENT_ID: string | undefined = import.meta.env.VITE_ASTRALBEAM_AGENT_ID ||
  undefined
