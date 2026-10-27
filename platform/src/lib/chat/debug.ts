import { EventType, type Logger } from "@tanstack/ai"
import { Effect } from "effect"

import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { errorReason } from "@/lib/runtime/failure-report.server"

export function chatDebugLog(runId: string) {
  return (category: string, summary: string, data?: unknown) =>
    Effect.logInfo(summary, ...(data === undefined ? [] : [data])).pipe(
      Effect.annotateLogs({ runId, debug: category }),
    )
}

// Native logs include provider diagnostics and pre-normalized middleware snapshots. Redact
// before Effect receives them, without traversing SDK instances or changing execution inputs.
function redactChatNativeDebugData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) return { reason: errorReason(value) }
  if (typeof value === "string" && value.startsWith("data:")) return "[redacted]"
  if (value === null || typeof value !== "object")
    return typeof value === "function" ? "[redacted]" : value
  if (seen.has(value)) return "[circular]"
  const prototype: unknown = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    return "[redacted]"
  if ("type" in value && (value.type === EventType.RUN_ERROR || value.type === "error"))
    return { type: value.type, reason: errorReason(value) }
  seen.add(value)
  const redacted = Array.isArray(value)
    ? value.map((entry) => redactChatNativeDebugData(entry, seen))
    : Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          /^(?:source|data|bytes|base64|b64_json|file_data|rawEvent|diagnostics?|headers|request|response|authorization|cookie|credentials?|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|(?:client[_-]?)?secret)$/i.test(
            key,
          )
            ? "[redacted]"
            : key === "error"
              ? { reason: errorReason(entry) }
              : redactChatNativeDebugData(entry, seen),
        ]),
      )
  seen.delete(value)
  return redacted
}

export function chatDebugLogger({
  runId,
  execute = runAppEffect,
}: {
  readonly runId: string
  readonly execute?: (effect: Effect.Effect<void>) => Promise<void>
}): Logger {
  const write =
    (level: "Info" | "Warn" | "Error"): Logger["debug"] =>
    (summary, data) => {
      void execute(
        Effect.logWithLevel(level)(
          summary,
          ...(data === undefined ? [] : [redactChatNativeDebugData(data)]),
        ).pipe(Effect.annotateLogs({ runId })),
      ).catch(() => {})
    }
  return { debug: write("Info"), info: write("Info"), warn: write("Warn"), error: write("Error") }
}
