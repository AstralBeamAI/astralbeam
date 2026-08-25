import type { StreamChunk } from "@tanstack/ai"

import { APP_HANDLE } from "@/lib/constants"
import { ANSI_BADGE, ANSI_DIM, ANSI_RESET, CATEGORY_ANSI } from "./constants.server"
import type { DebugLog } from "./types"

// Mirrors the SDK's browser-console debug logger so a `debug: true` conversation can be
// followed from both sides: UTC timestamp, colored category, then the full data object.
export function createDebugLog(runId: string): DebugLog {
  return (category, summary, data) => {
    const color = CATEGORY_ANSI[category] ?? ""
    console.log(
      `${ANSI_BADGE} ${APP_HANDLE} ${ANSI_RESET} ${ANSI_DIM}${
        new Date().toISOString()
      } run=${runId}${ANSI_RESET} ${color}${category}${ANSI_RESET} ${summary}`,
    )
    if (data !== undefined) console.dir(data, { depth: null, colors: true })
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// Streams are many tiny deltas; logging each would drown the terminal, so text and tool
// inputs accumulate per id and log whole on their end event. Everything else logs as-is.
export async function* withDebugLog(
  stream: AsyncIterable<StreamChunk>,
  log: DebugLog,
): AsyncIterable<StreamChunk> {
  const texts = new Map<string, string>()
  const toolCalls = new Map<string, { name: string; args: string }>()
  try {
    for await (const chunk of stream) {
      const event = chunk as {
        type: string
        messageId?: string
        delta?: string
        toolCallId?: string
        toolCallName?: string
        content?: string
        message?: string
      }
      switch (event.type) {
        case "TEXT_MESSAGE_START":
        case "REASONING_MESSAGE_START":
        case "THINKING_TEXT_MESSAGE_START":
          break
        case "TEXT_MESSAGE_CONTENT":
        case "TEXT_MESSAGE_CHUNK": {
          const key = event.messageId ?? "text"
          texts.set(key, (texts.get(key) ?? "") + (event.delta ?? ""))
          break
        }
        case "TEXT_MESSAGE_END":
          log("text", texts.get(event.messageId ?? "text") ?? "", { messageId: event.messageId })
          texts.delete(event.messageId ?? "text")
          break
        case "REASONING_MESSAGE_CONTENT":
        case "REASONING_MESSAGE_CHUNK":
        case "THINKING_TEXT_MESSAGE_CONTENT": {
          const key = `reasoning:${event.messageId ?? "thinking"}`
          texts.set(key, (texts.get(key) ?? "") + (event.delta ?? ""))
          break
        }
        case "REASONING_MESSAGE_END":
        case "THINKING_TEXT_MESSAGE_END": {
          const key = `reasoning:${event.messageId ?? "thinking"}`
          log("reasoning", texts.get(key) ?? "", { messageId: event.messageId })
          texts.delete(key)
          break
        }
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
            content: parseJson(event.content ?? ""),
          })
          break
        case "RUN_STARTED":
          log("run", "run started", chunk)
          break
        case "RUN_FINISHED":
          log("run", "run finished", chunk)
          break
        case "RUN_ERROR":
          log("error", `run failed: ${event.message}`, chunk)
          break
        default:
          log("stream", event.type, chunk)
      }
      yield chunk
    }
    log("run", "stream closed")
  } catch (error) {
    log("error", "stream threw", error)
    throw error
  }
}
