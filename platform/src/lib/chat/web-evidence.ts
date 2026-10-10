import { EventType, type ModelMessage, type StreamChunk } from "@tanstack/ai"
import { Schema } from "effect"
import { Sse } from "effect/encoding"
import { APP_HANDLE } from "@/lib/constants"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { chatStoredJson } from "./threads/projection"

export const CHAT_WEB_EVIDENCE_EVENT = `${APP_HANDLE}_private_web_evidence`

const ChatWebSourceSchema = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  excerpt: Schema.optionalKey(Schema.String),
})
const ChatWebCitationSchema = Schema.Struct({
  ...ChatWebSourceSchema.fields,
  startIndex: Schema.Number,
  endIndex: Schema.Number,
  number: Schema.optionalKey(Schema.Number),
})
export const ChatWebEvidenceSchema = Schema.Struct({
  sources: Schema.Array(ChatWebSourceSchema),
  citations: Schema.Array(ChatWebCitationSchema),
})
type ChatWebJson = Record<string, typeof Schema.Json.Type>

export interface ChatWebObservation {
  messages: readonly ModelMessage[]
  replay: Map<string, readonly Schema.JsonObject[]>
  blocks: ChatWebJson[]
  inputJson: Map<number, string>
  evidence: {
    sources: (typeof ChatWebSourceSchema.Type)[]
    citations: (typeof ChatWebCitationSchema.Type)[]
  }
  usage: ChatWebJson
  stopReason: string | undefined
  requestBody: ChatWebJson | undefined
  continuation: ChatWebJson[] | undefined
  calls: number
  textOffset: number
}

function chatWebRecord(value: unknown): ChatWebJson {
  return Schema.is(Schema.JsonObject)(value) ? value : {}
}

function chatWebArray(
  value: typeof Schema.Json.Type | undefined,
): readonly (typeof Schema.Json.Type)[] {
  return Array.isArray(value) ? (value as readonly (typeof Schema.Json.Type)[]) : []
}

function chatWebSource(value: ChatWebJson): typeof ChatWebSourceSchema.Type | undefined {
  if (typeof value.url !== "string") return undefined
  try {
    const url = new URL(value.url)
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password)
      return undefined
    return {
      url: url.href,
      title: typeof value.title === "string" ? value.title : url.href,
      ...(typeof value.excerpt === "string" ? { excerpt: value.excerpt } : {}),
    }
  } catch {
    return undefined
  }
}

function collectChatWebSources(value: unknown, sources: ChatWebObservation["evidence"]["sources"]) {
  if (Array.isArray(value)) {
    for (const item of value) collectChatWebSources(item, sources)
  } else if (Schema.is(Schema.JsonObject)(value)) {
    const document = chatWebRecord(value.content)
    const documentSource = chatWebRecord(document.source)
    const source = chatWebSource({
      ...value,
      title: value.title ?? document.title ?? null,
      excerpt:
        typeof value.cited_text === "string"
          ? value.cited_text
          : typeof value.content === "string"
            ? value.content
            : documentSource.type === "text" && typeof documentSource.data === "string"
              ? documentSource.data.slice(0, 2000)
              : (value.excerpt ?? null),
    })
    if (source && !sources.some((existing) => existing.url === source.url)) sources.push(source)
    for (const [key, child] of Object.entries(value)) {
      if (key !== "input" && key !== "arguments") collectChatWebSources(child, sources)
    }
  }
}

// Fetch citations refer to document indexes, not URLs. Resolve only returned document evidence.
// https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool#response
function collectChatWebDocuments(value: unknown, documents: ChatWebJson[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectChatWebDocuments(item, documents)
  } else if (Schema.is(Schema.JsonObject)(value)) {
    if (value.type === "web_fetch_result") {
      const document = chatWebRecord(value.content)
      documents.push({ url: value.url ?? null, title: document.title ?? null })
    } else if (value.type === "document") documents.push({ title: value.title ?? null })
    else
      for (const [key, child] of Object.entries(value))
        if (key !== "input") collectChatWebDocuments(child, documents)
  }
}

function appendChatWebCitation(state: ChatWebObservation, raw: unknown, offset?: number) {
  const annotation = chatWebRecord(raw)
  const value =
    annotation.type === "url_citation"
      ? chatWebRecord(annotation.url_citation ?? annotation)
      : annotation
  const documents: ChatWebJson[] = []
  if (typeof value.document_index === "number") {
    collectChatWebDocuments(state.requestBody?.messages, documents)
    collectChatWebDocuments(state.blocks, documents)
  }
  const document =
    typeof value.document_index === "number" ? documents[value.document_index] : undefined
  const source = chatWebSource({
    ...document,
    ...value,
    url: value.url ?? document?.url ?? null,
    title: value.title ?? value.document_title ?? document?.title ?? null,
    excerpt: value.cited_text ?? value.content ?? null,
  })
  if (!source) return
  const startIndex =
    typeof value.start_index === "number"
      ? value.start_index + (offset ?? state.textOffset)
      : (offset ?? 0)
  const endIndex =
    typeof value.end_index === "number"
      ? value.end_index + (offset ?? state.textOffset)
      : (offset ?? 0)
  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(endIndex) ||
    startIndex < 0 ||
    endIndex < startIndex
  )
    return
  const citation = { ...source, startIndex, endIndex }
  if (!state.evidence.citations.some((item) => JSON.stringify(item) === JSON.stringify(citation)))
    state.evidence.citations.push(citation)
}

/** Observe original wire evidence before the maintained SDK discards unsupported fields. */
function observeChatWebEvent(
  state: ChatWebObservation,
  model: ChatModelConfiguration,
  event: ChatWebJson,
) {
  if (model.api === "anthropic-messages") {
    const index = typeof event.index === "number" ? event.index : 0
    if (event.type === "message_start")
      state.usage = { ...state.usage, ...chatWebRecord(chatWebRecord(event.message).usage) }
    if (event.type === "content_block_start")
      state.blocks[index] = chatWebRecord(event.content_block)
    if (event.type === "content_block_delta") {
      const delta = chatWebRecord(event.delta)
      const block = state.blocks[index]
      if (!block) return
      for (const key of ["text", "thinking", "signature"] as const)
        if (delta.type === `${key}_delta`)
          block[key] =
            (typeof block[key] === "string" ? block[key] : "") +
            (typeof delta[key] === "string" ? delta[key] : "")
      if (delta.type === "input_json_delta")
        state.inputJson.set(
          index,
          (state.inputJson.get(index) ?? "") +
            Schema.decodeUnknownSync(Schema.String)(delta.partial_json),
        )
      if (delta.type === "citations_delta") {
        const citation = chatWebRecord(delta.citation)
        block.citations = [...chatWebArray(block.citations), citation]
        const offset =
          state.textOffset +
          state.blocks.reduce(
            (total, item) => total + (typeof item.text === "string" ? item.text.length : 0),
            0,
          )
        appendChatWebCitation(state, citation, offset)
      }
    }
    if (event.type === "content_block_stop" && state.inputJson.has(index))
      state.blocks[index]!.input = Schema.decodeUnknownSync(Schema.Json)(
        JSON.parse(state.inputJson.get(index)!),
      )
    if (event.type === "message_delta") {
      state.stopReason = Schema.decodeUnknownSync(Schema.String)(
        chatWebRecord(event.delta).stop_reason,
      )
      state.usage = { ...state.usage, ...chatWebRecord(event.usage) }
    }
  } else if (model.providerType === "openrouter") {
    for (const choice of chatWebArray(event.choices)) {
      const delta = chatWebRecord(chatWebRecord(choice).delta)
      const annotations = chatWebArray(delta.annotations)
      if (annotations.length) state.blocks.push({ annotations })
      for (const annotation of annotations) appendChatWebCitation(state, annotation)
    }
    state.usage = { ...state.usage, ...chatWebRecord(event.usage) }
  } else {
    const index = typeof event.output_index === "number" ? event.output_index : 0
    if (event.type === "response.output_item.added" || event.type === "response.output_item.done")
      state.blocks[index] = chatWebRecord(event.item)
    if (
      event.type === "response.content_part.added" ||
      event.type === "response.content_part.done" ||
      event.type === "response.output_text.delta" ||
      event.type === "response.output_text.annotation.added"
    ) {
      const block = state.blocks[index]
      if (block) {
        const content = chatWebArray(block.content).map(chatWebRecord)
        const partIndex = typeof event.content_index === "number" ? event.content_index : 0
        const part = content[partIndex] ?? { type: "output_text", text: "" }
        if (event.type === "response.output_text.delta")
          part.text =
            (typeof part.text === "string" ? part.text : "") +
            (typeof event.delta === "string" ? event.delta : "")
        if (event.type === "response.output_text.annotation.added")
          part.annotations = [...chatWebArray(part.annotations), event.annotation!]
        content[partIndex] = event.part ? chatWebRecord(event.part) : part
        block.content = content
      }
    }
    if (
      event.type === "response.completed" ||
      event.type === "response.incomplete" ||
      event.type === "response.failed"
    ) {
      const response = chatWebRecord(event.response)
      if (Array.isArray(response.output))
        state.blocks = chatWebArray(response.output).map(chatWebRecord)
      state.usage = { ...state.usage, ...chatWebRecord(response.usage) }
    }
    let offset = 0
    for (const item of state.blocks) {
      for (const content of chatWebArray(item.content)) {
        const part = chatWebRecord(content)
        for (const annotation of chatWebArray(part.annotations))
          appendChatWebCitation(state, annotation, offset)
        if (typeof part.text === "string") offset += part.text.length
      }
    }
  }
  collectChatWebSources(state.blocks, state.evidence.sources)
}

// TanStack currently omits citations_delta and treats pause_turn as stop.
// https://github.com/TanStack/ai/blob/main/packages/ai-anthropic/src/adapters/text.ts
export async function fetchChatWebProvider(
  model: ChatModelConfiguration,
  state: ChatWebObservation,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init)
  const body = chatWebRecord(JSON.parse(await request.clone().text()))
  if (model.api === "responses" || model.providerType === "openrouter") body.max_tool_calls = 5
  if (model.api === "anthropic-messages") {
    body.messages = chatWebArray(body.messages).map((value) => {
      const message = chatWebRecord(value)
      if (message.role === "assistant")
        message.content = chatWebArray(message.content).flatMap<typeof Schema.Json.Type>((part) => {
          const block = chatWebRecord(part)
          return typeof block.text === "string" ? (state.replay.get(block.text) ?? [part]) : [part]
        })
      return message
    })
  }
  if (model.providerType === "openrouter") {
    const messages = chatWebArray(body.messages)
    const offset = chatWebRecord(messages[0]).role === "system" ? 1 : 0
    body.messages = messages.map((value, index) => {
      const wire = chatWebRecord(value)
      const message = state.messages[index - offset]
      if (!message) return wire
      const raw: unknown = message.metadata?.astralbeamWeb
      if (message.role === "assistant" && Schema.is(Schema.Array(Schema.JsonObject))(raw))
        wire.annotations = raw.flatMap((block) => chatWebArray(block.annotations))
      const documents = (Array.isArray(message.content) ? message.content : []).flatMap((part) => {
        if (part.type !== "document" || part.source.type !== "data") return []
        const filename = chatWebRecord(part.metadata).filename
        return [
          {
            type: "file",
            file: {
              filename: typeof filename === "string" ? filename : "document.pdf",
              file_data: `data:${part.source.mimeType};base64,${part.source.value}`,
            },
          },
        ]
      })
      if (documents.length)
        wire.content = [
          ...chatWebArray(wire.content).filter(
            (part) => chatWebRecord(part).text !== "[Attached document]",
          ),
          ...documents,
        ]
      return wire
    })
  }
  if (state.continuation) body.messages = state.continuation
  state.requestBody = body
  const response = await model.fetch(
    new Request(request, { method: "POST", body: JSON.stringify(body) }),
  )
  if (!response.ok || !response.body) return response
  const decoder = new TextDecoder()
  const parser = Sse.makeParser((event) => {
    if (event._tag === "Event" && event.data !== "[DONE]")
      observeChatWebEvent(state, model, chatWebRecord(JSON.parse(event.data)))
  })
  return new Response(
    response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(bytes, controller) {
          parser.feed(decoder.decode(bytes, { stream: true }))
          controller.enqueue(bytes)
        },
        flush() {
          parser.feed(decoder.decode())
        },
      }),
    ),
    { status: response.status, statusText: response.statusText, headers: response.headers },
  )
}

export function chatWebEvidenceChunk(
  state: ChatWebObservation,
): Extract<StreamChunk, { type: "CUSTOM" }> {
  return {
    type: EventType.CUSTOM,
    name: CHAT_WEB_EVIDENCE_EVENT,
    value: chatStoredJson({ web: state.evidence, raw: state.blocks, providerUsage: state.usage }),
  }
}

/** Public metadata is deliberately portable. Raw provider context is confined to modelMessages. */
export function publicChatWebPart<T extends typeof Schema.JsonObject.Type>(part: T): T {
  const metadata = chatWebRecord(part.metadata)
  const provider = metadata.providerExecuted === true
  const failed = metadata.failed === true
  if (!provider && !metadata.web && !metadata.astralbeamWeb) return part
  const web = Schema.is(ChatWebEvidenceSchema)(metadata.web)
    ? metadata.web
    : { sources: [], citations: [] }
  return {
    ...part,
    metadata: { ...(provider ? { providerExecuted: true } : {}), web },
    ...(provider && (part.state === "complete" || failed)
      ? {
          output: failed ? { error: "Web retrieval failed" } : { sources: web.sources },
          state: failed ? "error" : "complete",
        }
      : {}),
  }
}
