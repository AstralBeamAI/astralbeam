import type { StreamChunk } from "@tanstack/ai/client"
import type { UIMessage } from "@tanstack/ai-client"
// Type-only, so this chat-chunk module shares no runtime code with the client entry;
// the logger itself (src/lib/debug.ts) loads eagerly because the loader logs too.
import type { DebugLogger } from "../../lib/debug.ts"

// useChat lifecycle callbacks that mirror the run into the console; undefined when
// debugging is off, so useChat receives no callbacks at all.
export function createDebugCallbacks(debug: DebugLogger | undefined) {
  if (!debug) return undefined
  return {
    onChunk: createChunkLogger(debug),
    onResponse: (response?: Response) =>
      debug("run", response ? `endpoint responded with HTTP ${response.status}` : "request sent"),
    onFinish: (message: UIMessage) => debug("run", "assistant turn finished", message),
    onError: (chatError: Error) => debug("error", chatError.message, chatError),
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
function createChunkLogger(log: DebugLogger): (chunk: StreamChunk) => void {
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
