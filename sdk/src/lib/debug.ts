// Loaded eagerly by the client entry; the chat chunk reuses the same logger instance
// shape, but nothing here may import chat-chunk modules or dist/client.js grows.

const badgeStyle = (color: string) =>
  `background:${color};color:#fff;border-radius:3px;padding:1px 5px`
const BADGE_STYLE = `${badgeStyle("#7c3aed")};font-weight:600`
const TIME_STYLE = "color:#94a3b8;font-weight:400"
const CATEGORY_COLORS = {
  mount: "#7c3aed",
  auth: "#be185d",
  theme: "#8b5cf6",
  send: "#2563eb",
  run: "#0891b2",
  stream: "#0e7490",
  text: "#16a34a",
  reasoning: "#64748b",
  tool: "#d97706",
  widget: "#db2777",
  attachment: "#0d9488",
  sandbox: "#0369a1",
  questionnaire: "#9333ea",
  status: "#475569",
  error: "#dc2626",
} as const

/** Category of a debug line, each with its own badge color; a typo fails the typecheck. */
type DebugCategory = keyof typeof CATEGORY_COLORS

/** Logs one debug line: a colored category badge, a summary, and the full data. */
export type DebugLogger = (category: DebugCategory, summary: string, data?: unknown) => void

// Every line carries a UTC HH:MM:SS timestamp and, when given, the raw data object,
// so the console shows exactly what happened and when, with all fields expandable.
export function createDebugLogger(enabled: boolean | undefined): DebugLogger | undefined {
  if (!enabled) return undefined
  return (category, summary, data) => {
    console.log(
      `%cAstralBeam%c ${new Date().toISOString().slice(11, 19)} %c${category}%c ${summary}`,
      BADGE_STYLE,
      TIME_STYLE,
      badgeStyle(CATEGORY_COLORS[category]),
      "",
      ...(data === undefined ? [] : [data]),
    )
  }
}
