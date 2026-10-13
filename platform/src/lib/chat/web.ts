import { Sse } from "effect/encoding"
import { Schema } from "effect"
import { webSearchTool as openaiSearch } from "@tanstack/ai-openai/tools"
import {
  webSearchTool as anthropicSearch,
  webFetchTool as anthropicFetch,
} from "@tanstack/ai-anthropic/tools"
import {
  webSearchTool as routerSearch,
  webFetchTool as routerFetch,
} from "@tanstack/ai-openrouter/tools"
import type { Tool, ModelMessage } from "@tanstack/ai"
import type { WebEvidence, WebSource } from "@astralbeam/sdk/core"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { modelWebAccess } from "@/lib/model-providers/web.server"
import { ChatWebAccessUnavailable } from "./errors"
import { CHAT_MAX_MODEL_TURNS } from "./constants"
import { APP_HANDLE } from "@/lib/constants"

export const CHAT_WEB_ACTIVITY_EVENT = `${APP_HANDLE}_web_activity`

type WebJson = Record<string, Schema.Json>

export interface ChatWebState {
  blocks: WebJson[]
  request: WebJson
  replay: Map<string, WebJson[]>
  usage: WebJson[]
  calls: number
  pause: boolean
  active: boolean
  settled: boolean
  failed: boolean
  offset: number
  evidence: WebEvidence
  onActivity?: (() => void) | undefined
}

export function chatWebState(): ChatWebState {
  return {
    blocks: [],
    request: {},
    replay: new Map(),
    usage: [],
    calls: 0,
    pause: false,
    active: false,
    settled: false,
    failed: false,
    offset: 0,
    evidence: { sources: [], citations: [] },
  }
}

export function chatWebTools(
  model: ChatModelConfiguration,
  enabled: boolean,
  browserTools: Tool[],
): Tool[] {
  if (!enabled) return []
  if (modelWebAccess(model) === false) throw new ChatWebAccessUnavailable()
  const tools =
    model.providerType === "openrouter"
      ? [routerSearch(), routerFetch()]
      : model.api === "responses"
        ? [openaiSearch({ type: "web_search" })]
        : [
            anthropicSearch({ type: "web_search_20250305", name: "web_search", max_uses: 5 }),
            anthropicFetch({ max_uses: 5, citations: { enabled: true } }),
          ]
  if (
    browserTools.some((tool) =>
      [
        "web_search",
        "web_fetch",
        "openrouter:web_search",
        "openrouter:web_fetch",
        "web_access",
      ].includes(tool.name),
    )
  )
    throw new ChatWebAccessUnavailable()
  return tools
}

function webJson(value: unknown): WebJson {
  return Schema.is(Schema.JsonObject)(value) ? value : {}
}

function webString(value: Schema.Json | undefined): string {
  return typeof value === "string" ? value : ""
}

function webSource(value: WebJson): WebSource | undefined {
  return typeof value.url === "string"
    ? {
        url: value.url,
        title: typeof value.title === "string" ? value.title : value.url,
        ...(typeof value.excerpt === "string" ? { excerpt: value.excerpt } : {}),
      }
    : undefined
}

function webDocuments(blocks: WebJson[]): WebSource[] {
  return blocks.flatMap((block) => {
    const content = webJson(block.content)
    const source = webSource({
      ...content,
      url: block.url ?? "",
      excerpt:
        webJson(content.source).type === "text" ? (webJson(content.source).data ?? null) : null,
    })
    return block.type === "web_fetch_result" && source ? [source] : []
  })
}

function webCitation(state: ChatWebState, value: WebJson, offset: number) {
  const messages = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(
    state.request.messages ?? [],
  )
  const documents = [
    ...messages.flatMap((message) =>
      Array.isArray(message.content) ? message.content.map(webJson) : [],
    ),
    ...state.blocks,
  ].flatMap((block) =>
    block.type === "document" ? [undefined] : webDocuments([webJson(block.content)]),
  )
  const source = webSource({
    ...documents[Number(value.document_index)],
    ...value,
    url: value.url ?? documents[Number(value.document_index)]?.url ?? null,
    title:
      value.title ?? value.document_title ?? documents[Number(value.document_index)]?.title ?? null,
    excerpt: value.cited_text ?? value.content ?? null,
  })
  if (!source) return
  const citation = {
    ...source,
    startIndex: typeof value.start_index === "number" ? value.start_index : offset,
    endIndex: typeof value.end_index === "number" ? value.end_index : offset,
    number: state.evidence.citations.length + 1,
  }
  if (
    !state.evidence.citations.some(
      (saved) =>
        saved.url === citation.url &&
        saved.startIndex === citation.startIndex &&
        saved.endIndex === citation.endIndex,
    )
  )
    state.evidence.citations.push(citation)
}

function observeAnthropicWeb(state: ChatWebState, event: WebJson) {
  const index = Number(event.index ?? 0)
  if (event.type === "content_block_start") {
    const block = webJson(event.content_block)
    state.blocks[index] = block
    if (block.type === "server_tool_use") {
      state.active = true
      state.settled = false
    }
    if (block.type === "web_fetch_tool_result" || block.type === "web_search_tool_result") {
      state.active = true
      state.settled = true
    }
    const content = webJson(block.content)
    if (typeof content.error_code === "string") state.failed = true
    const sources = Array.isArray(block.content)
      ? block.content.map(webJson).flatMap((item) => webSource(item) ?? [])
      : webDocuments([content])
    state.evidence.sources.push(...sources)
  }
  if (event.type === "content_block_delta") {
    const delta = webJson(event.delta)
    const block = state.blocks[index]!
    for (const key of ["text", "thinking", "signature"])
      if (delta.type === `${key}_delta`) block[key] = webString(block[key]) + webString(delta[key])
    if (delta.type === "input_json_delta")
      block.json = webString(block.json) + webString(delta.partial_json)
    if (delta.type === "citations_delta") {
      block.citations = [
        ...Schema.decodeUnknownSync(Schema.Array(Schema.Json))(block.citations ?? []),
        delta.citation!,
      ]
      webCitation(
        state,
        webJson(delta.citation),
        state.offset + state.blocks.reduce((n, item) => n + webString(item.text).length, 0),
      )
    }
  }
  if (event.type === "content_block_stop" && typeof state.blocks[index]?.json === "string") {
    state.blocks[index].input = Schema.decodeUnknownSync(Schema.Json)(
      JSON.parse(webString(state.blocks[index]?.json)),
    )
    delete state.blocks[index].json
  }
  if (event.type === "message_delta") {
    state.pause = webJson(event.delta).stop_reason === "pause_turn"
    state.usage.push(webJson(event.usage))
  }
}

function observeResponsesWeb(state: ChatWebState, event: WebJson) {
  switch (event.type) {
    case "response.output_item.added": {
      const item = webJson(event.item)
      state.blocks[Number(event.output_index)] = item
      if (item.type === "web_search_call") {
        state.active = true
        state.settled = false
      }
      return
    }
    case "response.content_part.done":
    case "response.output_text.annotation.added": {
      const block = state.blocks[Number(event.output_index)]!
      const content = Array.isArray(block.content) ? block.content : []
      const index = Number(event.content_index)
      const part = webJson(content[index])
      content[index] =
        event.type === "response.content_part.done"
          ? webJson(event.part)
          : {
              ...part,
              annotations: [
                ...Schema.decodeUnknownSync(Schema.Array(Schema.Json))(part.annotations ?? []),
                event.annotation!,
              ],
            }
      block.content = content
      break
    }
    case "response.output_item.done":
      state.blocks[Number(event.output_index)] = webJson(event.item)
      break
    case "response.completed": {
      const response = webJson(event.response)
      state.blocks = [
        ...Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(
          response.output ?? state.blocks,
        ),
      ]
      state.usage.push(webJson(response.usage))
      break
    }
    default:
      return
  }
  let offset = 0
  for (const block of state.blocks) {
    if (block.type === "web_search_call") {
      state.active = true
      state.settled = block.status === "completed"
      if (block.status === "failed") state.failed = true
      const page = webSource(webJson(block.action))
      if (page) state.evidence.sources.push(page)
      const sources = webJson(block.action).sources
      if (Array.isArray(sources))
        state.evidence.sources.push(
          ...sources.map(webJson).flatMap((item) => webSource(item) ?? []),
        )
    }
    if (Array.isArray(block.content))
      for (const value of block.content) {
        const part = webJson(value)
        if (Array.isArray(part.annotations))
          for (const annotation of part.annotations) {
            const citation = webJson(annotation)
            webCitation(
              state,
              {
                ...citation,
                start_index: Number(citation.start_index) + offset,
                end_index: Number(citation.end_index) + offset,
              },
              offset,
            )
          }
        offset += webString(part.text).length
      }
  }
}

function observeRouterWeb(state: ChatWebState, event: WebJson) {
  const choices = Array.isArray(event.choices) ? event.choices : []
  for (const choice of choices) {
    const delta = webJson(webJson(choice).delta)
    if (Array.isArray(delta.reasoning_details))
      state.blocks.push({ reasoning_details: delta.reasoning_details })
    if (!Array.isArray(delta.annotations)) continue
    state.active = true
    state.settled = true
    state.blocks.push({ annotations: delta.annotations })
    for (const item of delta.annotations) {
      const annotation = webJson(item)
      webCitation(state, webJson(annotation.url_citation ?? annotation), 0)
    }
  }
  if (event.usage) {
    const usage = webJson(event.usage)
    state.usage.push(usage)
    const tools = webJson(usage.server_tool_use)
    if (Number(tools.web_search_requests ?? 0) + Number(tools.web_fetch_requests ?? 0) > 0) {
      state.active = true
      state.settled = true
    }
  }
}

// Capture fields the maintained adapters omit. https://github.com/TanStack/ai/tree/main/packages/ai-anthropic/src/adapters
export async function fetchChatWeb(
  model: Pick<ChatModelConfiguration, "api" | "providerType" | "fetch">,
  state: ChatWebState,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  if (++state.calls > CHAT_MAX_MODEL_TURNS) throw new ChatWebAccessUnavailable()
  const request = new Request(input, init)
  const body = webJson(await request.clone().json())
  if (model.api !== "anthropic-messages") body.max_tool_calls = 5
  const key = model.api === "responses" ? "input" : "messages"
  if (Array.isArray(body[key]))
    body[key] = body[key].flatMap((value) => {
      const item = webJson(value)
      const content = Array.isArray(item.content) ? item.content : [{ text: item.content }]
      const marker = content
        .map((part) => webJson(part).text)
        .find((text) => typeof text === "string" && state.replay.has(text))
      if (
        model.api === "anthropic-messages" &&
        typeof marker === "string" &&
        state.replay.get(marker)!.every((message) => message.role === item.role)
      )
        return [
          {
            ...item,
            content: content.flatMap((part) => {
              const key = webJson(part).text
              return typeof key === "string" && state.replay.has(key)
                ? state.replay
                    .get(key)!
                    .flatMap((message) =>
                      Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(message.content),
                    )
                : [webJson(part)]
            }),
          },
        ]
      return typeof marker === "string" ? state.replay.get(marker)! : [item]
    })
  state.request = body
  const response = await model.fetch(
    new Request(request, { method: "POST", body: JSON.stringify(body) }),
  )
  if (!response.ok || !response.body) return response
  const decoder = new TextDecoder()
  const parser = Sse.makeParser((event) => {
    if (event._tag !== "Event" || event.data === "[DONE]") return
    const value = webJson(JSON.parse(event.data))
    const active = state.active
    const settled = state.settled
    if (model.api === "anthropic-messages") observeAnthropicWeb(state, value)
    else if (model.providerType === "openrouter") observeRouterWeb(state, value)
    else observeResponsesWeb(state, value)
    if (state.active && (!active || settled !== state.settled)) state.onActivity?.()
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

export function chatWebContext(
  model: ChatModelConfiguration,
  state: ChatWebState,
  text: string,
  toolCalls: NonNullable<ModelMessage["toolCalls"]>,
): WebJson[] {
  return model.api === "responses"
    ? state.blocks.map((block) => {
        if (block.type !== "function_call") return block
        const { id: _id, ...call } = block
        return call
      })
    : [
        {
          role: "assistant",
          content: model.api === "anthropic-messages" ? state.blocks : text,
          ...(model.providerType === "openrouter"
            ? {
                annotations: state.blocks.flatMap((block) =>
                  Schema.decodeUnknownSync(Schema.Array(Schema.Json))(block.annotations ?? []),
                ),
                reasoning_details: state.blocks.flatMap((block) =>
                  Schema.decodeUnknownSync(Schema.Array(Schema.Json))(
                    block.reasoning_details ?? [],
                  ),
                ),
                tool_calls: toolCalls
                  .filter(
                    (call) =>
                      !Schema.is(Schema.Struct({ providerExecuted: Schema.Literal(true) }))(
                        call.metadata,
                      ),
                  )
                  .map((call) => ({ id: call.id, type: call.type, function: call.function })),
              }
            : {}),
        },
      ]
}
