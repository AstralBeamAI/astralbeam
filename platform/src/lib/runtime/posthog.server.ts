import { trace, type Attributes } from "@opentelemetry/api"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { parseKeyPairsIntoRecord } from "@opentelemetry/core"
import { Cause, Effect, Layer, Logger, References } from "effect"
import { PostHog, type PostHogOptions } from "posthog-node"

import type { ConfigValues } from "@/lib/config/types"
import { redactValue } from "@/lib/redaction"

// Nitro and SSR have separate module copies. Report each failure through one active client.
const posthogClientsKey = Symbol.for("platform.posthogClients")
const posthogClients = ((globalThis as typeof globalThis & { [posthogClientsKey]?: Set<PostHog> })[
  posthogClientsKey
] ??= new Set())

/** The Observability preset stores its OTLP endpoint, rather than a separate provider choice. */
export function posthogOptionsFromValues(values: ConfigValues) {
  const host = values.otel_exporter_otlp_endpoint?.match(
    /^(https:\/\/(?:us|eu)\.i\.posthog\.com)\/i\/?$/u,
  )?.[1]
  if (!host) return undefined
  const headers = [
    ...Object.entries(parseKeyPairsIntoRecord(values.otel_exporter_otlp_headers ?? "")),
    ...Object.entries(parseKeyPairsIntoRecord(values.otel_exporter_otlp_traces_headers ?? "")),
  ]
  const projectToken = headers
    .findLast(([name]) => name.toLowerCase() === "authorization")?.[1]
    .match(/^Bearer\s+(\S+)$/iu)?.[1]
  return projectToken ? { projectToken, host } : undefined
}

export function getPostHogClient(): PostHog | undefined {
  return posthogClients.values().next().value
}

export function withPostHogContext<A>(attributes: Attributes, next: () => A): A {
  const client = getPostHogClient()
  const distinctId = attributes["user.id"]
  const sessionId = attributes["session.id"]
  return client
    ? client.withContext(
        {
          ...(typeof distinctId === "string" ? { distinctId } : {}),
          ...(typeof sessionId === "string" ? { sessionId } : {}),
        },
        next,
        { fresh: true },
      )
    : next()
}

export function posthogClientLayer({
  projectToken,
  ...options
}: PostHogOptions & { projectToken: string }) {
  return Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.sync(() => {
        const client = new PostHog(projectToken, {
          ...options,
          enableExceptionAutocapture: true,
          before_send: redactValue,
        })
        posthogClients.add(client)
        return client
      }),
      (client) =>
        Effect.promise(async () => {
          posthogClients.delete(client)
          // Leave time for the other resources within the server's five-second shutdown deadline.
          await client.shutdown(2_000)
        }).pipe(Effect.catchDefect(() => Effect.logWarning("PostHog shutdown failed"))),
    ),
  )
}

export const posthogErrorLogger = Logger.make(({ cause, message, fiber, logLevel }) => {
  if (logLevel !== "Error" && logLevel !== "Fatal") return
  const client = getPostHogClient()
  if (!client) return
  // Retain IDs if telemetry shuts down before the SDK finishes processing the exception.
  const span = trace.getActiveSpan()?.spanContext()
  const properties = {
    ...fiber.getRef(References.CurrentLogAnnotations),
    logMessage: message,
    ...(span ? { $trace_id: span.traceId, $span_id: span.spanId } : {}),
  }
  for (const reason of cause.reasons) {
    if (Cause.isInterruptReason(reason)) continue
    const error = Cause.isFailReason(reason) ? reason.error : reason.defect
    client.captureException(error, undefined, properties)
  }
})

// Keep receiver-specific correlation aliases out of the shared span.
// https://posthog.com/docs/ai-observability/installation/opentelemetry
export function mapPostHogAttributes(attributes: Readonly<Attributes>): Attributes {
  return {
    ...attributes,
    posthogDistinctId: attributes.posthogDistinctId ?? attributes["user.id"],
    "posthog.distinct_id": attributes["posthog.distinct_id"] ?? attributes["user.id"],
    sessionId: attributes.sessionId ?? attributes["session.id"],
    $session_id: attributes.$session_id ?? attributes["session.id"],
  }
}

// The AI receiver accepts mixed OTLP streams and filters non-AI spans itself.
// https://posthog.com/docs/ai-observability/installation/opentelemetry
export function posthogAiExporter(options: { host: string; projectToken: string }) {
  return new OTLPTraceExporter({
    url: `${options.host}/i/v0/ai/otel`,
    headers: { Authorization: `Bearer ${options.projectToken}` },
  })
}
