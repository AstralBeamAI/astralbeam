import * as OtelTracer from "@effect/opentelemetry/OtelTracer"
import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { W3CTraceContextPropagator } from "@opentelemetry/core"
import { Effect, Layer, Option } from "effect"
import { getEventContext } from "nitro/h3"

const tracingContextKey = Symbol.for("platform.tracingContext")
const tracingContext = ((
  globalThis as typeof globalThis & {
    [tracingContextKey]?: {
      tracers: Set<Tracer>
      manager?: AsyncLocalStorageContextManager
    }
  }
)[tracingContextKey] ??= { tracers: new Set() })

// Nitro and SSR have separate module copies, but OpenTelemetry has one process-wide context.
// https://opentelemetry.io/docs/languages/js/context/
export const requestTracingLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.flatMap(Effect.serviceOption(OtelTracer.OtelTracer), (service) =>
      Effect.sync(() => {
        if (Option.isNone(service)) return undefined
        const tracer = service.value
        if (tracingContext.tracers.size === 0) {
          const manager = new AsyncLocalStorageContextManager().enable()
          if (context.setGlobalContextManager(manager)) tracingContext.manager = manager
          else manager.disable()
        }
        tracingContext.tracers.add(tracer)
        return tracer
      }),
    ),
    (tracer) =>
      Effect.sync(() => {
        if (!tracer) return
        tracingContext.tracers.delete(tracer)
        if (tracingContext.tracers.size === 0 && tracingContext.manager) {
          context.disable()
          delete tracingContext.manager
        }
      }),
  ),
)

type HttpTracingContext = { serverSpan?: Span }
const traceContextPropagator = new W3CTraceContextPropagator()
const traceHeaderGetter = {
  keys: (headers: Headers) => [...headers.keys()],
  get: (headers: Headers, key: string) => headers.get(key) ?? undefined,
}

/** Wraps Nitro, including its request/error/response hooks, without starting application services. */
export function traceHttpRequest(
  request: Request,
  next: (request: Request) => Response | Promise<Response>,
): Response | Promise<Response> {
  const tracer = tracingContext.tracers.values().next().value
  if (!tracer) return next(request)
  const url = new URL(request.url)
  const parent = traceContextPropagator.extract(
    context.active(),
    request.headers,
    traceHeaderGetter,
  )
  return tracer.startActiveSpan(
    request.method,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": request.method,
        "url.scheme": url.protocol.slice(0, -1),
        "server.address": url.hostname,
        "server.port": Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      },
    },
    parent,
    async (span) => {
      getEventContext<HttpTracingContext>({ req: request }).serverSpan = span
      try {
        const response = await next(request)
        span.setAttribute("http.response.status_code", response.status)
        if (response.status >= 500) {
          span.setAttribute("error.type", String(response.status))
          span.setStatus({ code: SpanStatusCode.ERROR })
        }
        return response
      } catch (error) {
        span.setAttribute("error.type", error instanceof Error ? error.name : "Error")
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        // Streaming children may finish later. This span measures response-ready latency.
        span.end()
      }
    },
  )
}

export function annotateHttpRoute(request: Request, route: string): void {
  const span = getHttpServerSpan(request)
  span?.setAttribute("http.route", route)
  if (span) span.updateName(`${request.method} ${route}`)
}

export function getHttpServerSpan(request: Request): Span | undefined {
  return getEventContext<HttpTracingContext>({ req: request }).serverSpan
}

/** Retains a Promise caller's parent when Effect resumes in another socket's async context. */
export function withActiveSpan<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const parent = trace.getSpanContext(context.active())
  return parent ? OtelTracer.withSpanContext(effect, parent) : effect
}

export function traceRequestInit(
  input: RequestInfo | URL,
  init?: RequestInit,
): RequestInit | undefined {
  const active = context.active()
  if (!trace.getSpan(active)) return init
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  )
  traceContextPropagator.inject(active, headers, {
    set: (carrier: Headers, key, value) => carrier.set(key, value),
  })
  return { ...init, headers }
}

export function fetchWithTraceContext(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, traceRequestInit(input, init))
}
