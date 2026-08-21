export const BASE_SYSTEM_PROMPT =
  "You are the AstralBeam assistant, embedded as a chat widget inside a host application. " +
  "Be concise and act through the declared tools. Widgets and questionnaires already render " +
  "their results in the conversation, so do not repeat their content in your replies."

// Interim per-instance abuse guard while the endpoint is unauthenticated: a fixed one-minute
// request window per client address, held in memory.
export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_MAX_REQUESTS = 20

export const ANSI_RESET = "\x1b[0m"
export const ANSI_BADGE = "\x1b[45;97m" // magenta background, white text
export const ANSI_DIM = "\x1b[2m"
export const CATEGORY_ANSI: Record<string, string> = {
  request: "\x1b[36m",
  run: "\x1b[34m",
  stream: "\x1b[35m",
  text: "\x1b[32m",
  reasoning: "\x1b[90m",
  tool: "\x1b[33m",
  error: "\x1b[31m",
}
