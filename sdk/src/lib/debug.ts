import type { StreamChunk } from "@tanstack/ai/client"

/** Logs one debug line: a colored category badge, a summary, and the full data. */
export type DebugLogger = (category: string, summary: string, data?: unknown) => void

const BADGE_STYLE =
  "background:#7c3aed;color:#fff;border-radius:3px;padding:1px 5px;font-weight:600"
const TIME_STYLE = "color:#94a3b8;font-weight:400"
const CATEGORY_COLORS: Record<string, string> = {
  mount: "#7c3aed",
  theme: "#8b5cf6",
  send: "#2563eb",
  run: "#0891b2",
  stream: "#0e7490",
  text: "#16a34a",
  reasoning: "#64748b",
  tool: "#d97706",
  widget: "#db2777",
  questionnaire: "#9333ea",
  status: "#475569",
  error: "#dc2626",
}

// Every line carries a UTC timestamp and, when given, the raw data object so the
// console shows exactly what happened and when, with all fields expandable.
export function createDebugLogger(enabled: boolean | undefined): DebugLogger | undefined {
  if (!enabled) return undefined
  return (category, summary, data) => {
    const categoryStyle = `background:${
      CATEGORY_COLORS[category] ?? "#475569"
    };color:#fff;border-radius:3px;padding:1px 5px`
    console.log(
      `%cAstralBeam%c ${new Date().toISOString()} %c${category}%c ${summary}`,
      BADGE_STYLE,
      TIME_STYLE,
      categoryStyle,
      "",
      ...(data === undefined ? [] : [data]),
    )
  }
}

// Loose view over the AG-UI chunk fields the logger reads; chunks are typed with
// enum discriminants upstream, which plain string switches cannot narrow.
interface ChunkFields {
  type: string
  messageId?: string
  delta?: string
  toolCallId?: string
  toolCallName?: string
  content?: string
  runId?: string
  message?: string
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// Streams arrive as many tiny deltas; logging each would drown the console, so text
// and tool inputs accumulate per id and log whole when their end event arrives.
export function createChunkLogger(log: DebugLogger): (chunk: StreamChunk) => void {
  const texts = new Map<string, string>()
  const toolCalls = new Map<string, { name: string; args: string }>()
  const appendText = (key: string, delta: string) => {
    texts.set(key, (texts.get(key) ?? "") + delta)
  }
  const takeText = (key: string) => {
    const text = texts.get(key) ?? ""
    texts.delete(key)
    return text
  }
  return (chunk) => {
    const event = chunk as unknown as ChunkFields
    switch (event.type) {
      case "TEXT_MESSAGE_CONTENT":
      case "TEXT_MESSAGE_CHUNK":
        appendText(event.messageId ?? "text", event.delta ?? "")
        break
      case "TEXT_MESSAGE_END":
        log("text", takeText(event.messageId ?? "text"), { messageId: event.messageId })
        break
      case "REASONING_MESSAGE_CONTENT":
      case "REASONING_MESSAGE_CHUNK":
      case "THINKING_TEXT_MESSAGE_CONTENT":
        appendText(`reasoning:${event.messageId ?? "thinking"}`, event.delta ?? "")
        break
      case "REASONING_MESSAGE_END":
      case "THINKING_TEXT_MESSAGE_END":
        log("reasoning", takeText(`reasoning:${event.messageId ?? "thinking"}`), {
          messageId: event.messageId,
        })
        break
      case "TOOL_CALL_START":
        log("tool", `${event.toolCallName} call started`, chunk)
        toolCalls.set(event.toolCallId ?? "", { name: event.toolCallName ?? "", args: "" })
        break
      case "TOOL_CALL_ARGS": {
        const call = toolCalls.get(event.toolCallId ?? "")
        if (call) call.args += event.delta ?? ""
        break
      }
      case "TOOL_CALL_END": {
        const call = toolCalls.get(event.toolCallId ?? "")
        toolCalls.delete(event.toolCallId ?? "")
        log("tool", `${call?.name ?? "tool"} input complete`, {
          toolCallId: event.toolCallId,
          input: parseJson(call?.args ?? ""),
        })
        break
      }
      case "TOOL_CALL_RESULT":
        log("tool", `result for tool call ${event.toolCallId}`, {
          toolCallId: event.toolCallId,
          messageId: event.messageId,
          content: parseJson(event.content ?? ""),
        })
        break
      case "TEXT_MESSAGE_START":
      case "REASONING_MESSAGE_START":
      case "THINKING_TEXT_MESSAGE_START":
        break
      case "RUN_STARTED":
        log("run", `run ${event.runId} started`, chunk)
        break
      case "RUN_FINISHED":
        log("run", `run ${event.runId} finished`, chunk)
        break
      case "RUN_ERROR":
        log("error", `run failed: ${event.message}`, chunk)
        break
      default:
        log("stream", event.type, chunk)
    }
  }
}
