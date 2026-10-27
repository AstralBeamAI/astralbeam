// Public configuration only. The API key belongs in config.server.ts.
export const APP_NAME = "AstralBeam Todos"
export const CHAT_TITLE = "Todos assistant"
export const ASTRALBEAM_API_URL =
  import.meta.env.VITE_ASTRALBEAM_API_URL || "http://localhost:4500/api"
export const CHAT_AGENT_ID: string | undefined =
  import.meta.env.VITE_ASTRALBEAM_AGENT_ID || undefined
