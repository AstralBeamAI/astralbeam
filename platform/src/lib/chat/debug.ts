import { EventType, type StreamChunk } from "@tanstack/ai"
import { Cause, Effect, Result, Stream } from "effect"

import { errorReason } from "@/lib/runtime/failure-report.server"

/**
 * Logs one line of a `debug: true` run, development only because it prints whole conversations.
 * It mirrors the SDK's browser-console debug log so both sides of a run can be followed.
 */
export type ChatDebugLog = (
  category: string,
  summary: string,
  data?: unknown,
) => Effect.Effect<void>

export function chatDebugLog(runId: string): ChatDebugLog {
  return (category, summary, data) =>
    Effect.logInfo(summary, ...(data === undefined ? [] : [data])).pipe(
      Effect.annotateLogs({ runId, debug: category }),
    )
}

interface ChatDebugState {
  readonly texts: Readonly<Record<string, string>>
  readonly toolCalls: Readonly<Record<string, { readonly name: string; readonly args: string }>>
}

type ChatDebugEntry = readonly [category: string, summary: string, data?: unknown]

function parseChatDebugJson(text: string): unknown {
  // Tool arguments and results are usually JSON, but a partial or plain payload logs as text.
  return Result.getOrElse(
    Result.try(() => JSON.parse(text) as unknown),
    () => text,
  )
}

function appendChatDebugText(state: ChatDebugState, key: string, delta = ""): ChatDebugState {
  return { ...state, texts: { ...state.texts, [key]: (state.texts[key] ?? "") + delta } }
}

function takeChatDebugText(state: ChatDebugState, key: string): [ChatDebugState, string] {
  const { [key]: text = "", ...texts } = state.texts
  return [{ ...state, texts }, text]
}

// Streams are many tiny deltas and logging each would drown the terminal, so text and tool inputs
// accumulate per id and log whole on their end event. Everything else logs as it arrives.
function describeChatChunk(
  state: ChatDebugState,
  chunk: StreamChunk,
): readonly [ChatDebugState, ChatDebugEntry | undefined] {
  const event = chunk
  switch (event.type) {
    case EventType.TEXT_MESSAGE_START:
    case EventType.REASONING_MESSAGE_START:
      return [state, undefined]
    case EventType.TEXT_MESSAGE_CONTENT:
    case EventType.TEXT_MESSAGE_CHUNK:
      return [appendChatDebugText(state, event.messageId ?? "text", event.delta), undefined]
    case EventType.TEXT_MESSAGE_END: {
      const [next, text] = takeChatDebugText(state, event.messageId ?? "text")
      return [next, ["text", text, { messageId: event.messageId }]]
    }
    case EventType.REASONING_MESSAGE_CONTENT:
    case EventType.REASONING_MESSAGE_CHUNK:
      return [
        appendChatDebugText(state, `reasoning:${event.messageId ?? "thinking"}`, event.delta),
        undefined,
      ]
    case EventType.REASONING_MESSAGE_END: {
      const [next, text] = takeChatDebugText(state, `reasoning:${event.messageId ?? "thinking"}`)
      return [next, ["reasoning", text, { messageId: event.messageId }]]
    }
    case EventType.TOOL_CALL_START: {
      const call = { name: event.toolCallName ?? "", args: "" }
      const toolCalls = { ...state.toolCalls, [event.toolCallId ?? ""]: call }
      return [{ ...state, toolCalls }, ["tool", `${event.toolCallName} call started`, chunk]]
    }
    case EventType.TOOL_CALL_ARGS: {
      const call = state.toolCalls[event.toolCallId ?? ""]
      if (!call) return [state, undefined]
      const toolCalls = {
        ...state.toolCalls,
        [event.toolCallId ?? ""]: { ...call, args: call.args + (event.delta ?? "") },
      }
      return [{ ...state, toolCalls }, undefined]
    }
    case EventType.TOOL_CALL_END: {
      const { [event.toolCallId ?? ""]: call, ...toolCalls } = state.toolCalls
      const input = { toolCallId: event.toolCallId, input: parseChatDebugJson(call?.args ?? "") }
      return [{ ...state, toolCalls }, ["tool", `${call?.name ?? "tool"} input complete`, input]]
    }
    case EventType.TOOL_CALL_RESULT: {
      const content =
        typeof event.content === "string" ? parseChatDebugJson(event.content) : event.content
      const summary = `result for tool call ${event.toolCallId}`
      return [state, ["tool", summary, { toolCallId: event.toolCallId, content }]]
    }
    case EventType.RUN_STARTED:
      return [state, ["run", "run started", chunk]]
    case EventType.RUN_FINISHED:
      return [state, ["run", "run finished", chunk]]
    case EventType.RUN_ERROR:
      return [state, ["error", `run failed: ${event.message}`, chunk]]
    default:
      return [state, ["stream", event.type, chunk]]
  }
}

/** Logs a run's events as they pass, without changing or delaying the stream. */
export function withChatDebugLog(log: ChatDebugLog) {
  return <E, R>(stream: Stream.Stream<StreamChunk, E, R>) =>
    stream.pipe(
      Stream.mapAccumEffect(
        (): ChatDebugState => ({ texts: {}, toolCalls: {} }),
        (state, chunk) => {
          const [next, entry] = describeChatChunk(state, chunk)
          return Effect.as(entry ? log(...entry) : Effect.void, [next, [chunk]] as const)
        },
      ),
      Stream.onEnd(log("run", "stream closed")),
      Stream.tapCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : log("error", "stream threw", errorReason(Cause.squash(cause))),
      ),
    )
}
