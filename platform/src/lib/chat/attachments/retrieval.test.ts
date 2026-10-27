import { chat, type ModelMessage } from "@tanstack/ai"
import { Effect, type Schema } from "effect"
import { expect, test, vi } from "vitest"

import { APP_HANDLE } from "@/lib/constants"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { createChatAdapter } from "../adapter"
import { projectChatModelHistory, type ChatProjectionRecord } from "../threads/projection"
import { chatWebState } from "../web"
import { normalizeChatAttachments } from "./attachments"
import {
  chatAttachmentCatalogue,
  chatAttachmentInputFileIds,
  projectChatAttachmentRetrievals,
} from "./retrieval"
import { createChatAttachmentTools } from "./tools"
import { prepareChatProviderHistory } from "./provider-history"
import { CHAT_ATTACHMENT_MAX_BYTES_BY_KIND, CHAT_ATTACHMENT_MAX_TOTAL_BYTES } from "./constants"

const FILE_ID = "0199b600-0000-7000-8000-000000000001"
const PDF = Buffer.from("%PDF-1.7").toString("base64")
const MODEL = {
  providerId: "provider",
  api: "responses",
  modelId: "custom-model",
  providerType: "openai",
} as const

function attachmentHistory(
  options: {
    mediaType?: "image" | "document"
    executionLocation?: string
    name?: string
    toolSource?: string
    authorTenantUserId?: string
    responseTargetId?: string
    bytes?: number
  } = {},
): ChatProjectionRecord[] {
  const message = (
    id: string,
    role: ChatProjectionRecord["role"],
    part: typeof Schema.JsonObject.Type & { type: string },
  ): ChatProjectionRecord => ({
    id,
    role,
    state: "complete",
    payload: { version: 1, parts: [{ id: `${id}-part`, ...part }] },
  })
  return [
    message("upload", "user", {
      type: options.mediaType ?? "document",
      metadata: { filename: "report.pdf" },
      source: {
        type: APP_HANDLE,
        id: FILE_ID,
        mimeType: options.mediaType === "image" ? "image/png" : "application/pdf",
        byteSize: options.bytes ?? 8,
      },
    }),
    message("decision", "assistant", {
      type: "tool-call",
      name: options.name ?? "read_attachment",
      toolCallId: "read_1",
      arguments: JSON.stringify({ fileId: FILE_ID }),
      executionLocation: options.executionLocation ?? "server_api",
      declaration: { source: options.toolSource ?? "chat-attachment" },
      targets: [{ id: "slot" }],
    }),
    {
      ...message("result", "tool", {
        type: "tool-result",
        toolCallId: "read_1",
        outcome: "succeeded",
        output: {
          type: "attachment-reference",
          version: 1,
          fileId: FILE_ID,
          sourceMessageId: "upload",
        },
      }),
      sourceAssistantMessageId: "decision",
      sourceToolPartId: "decision-part",
      responseTargetId: options.responseTargetId ?? "slot",
      authorTenantUserId: options.authorTenantUserId ?? null,
    },
  ]
}

function hydrateAttachmentFixture(messages: readonly ModelMessage[], value = PDF): ModelMessage[] {
  return messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) =>
          part.type === "image" || part.type === "document"
            ? {
                ...part,
                source: {
                  type: "data",
                  value,
                  mimeType: part.type === "image" ? "image/png" : "application/pdf",
                },
              }
            : part,
        )
      : message.content,
  }))
}

function attachmentProjection(
  history = attachmentHistory(),
  protocol = "responses",
  openRouterDocuments = false,
) {
  return projectChatAttachmentRetrievals({
    history,
    messages: projectChatModelHistory(history).filter(
      (message) => !message.id?.startsWith("upload:"),
    ),
    catalogue: chatAttachmentCatalogue(history),
    media: { protocol, openRouterDocuments },
  })
}

function prepareAttachmentFixture(history: ChatProjectionRecord[], value: string) {
  return Effect.runPromise(
    prepareChatProviderHistory({
      history,
      model: MODEL,
      webAccessEnabled: false,
      sandbox: false,
      scope: { organizationId: "organization", tenantId: "tenant", threadId: "thread" },
      files: {
        hydrate: ({ messages }) => Effect.succeed(hydrateAttachmentFixture(messages, value)),
      },
    }),
  )
}

test("provider preparation budgets actual hydrated bytes, including repeated recovery", async () => {
  const bytes = Buffer.alloc(CHAT_ATTACHMENT_MAX_BYTES_BY_KIND.pdf)
  bytes.write("%PDF-1.7")
  const value = bytes.toString("base64")
  const history = attachmentHistory()
  expect((await prepareAttachmentFixture(history, value)).remainingBytes).toBe(0)
  await expect(
    prepareAttachmentFixture(
      [history[0]!, { ...history[0]!, id: "another-upload" }, ...history.slice(1)],
      value,
    ).then(() => undefined),
  ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
})

test("OpenRouter recovers bounded document groups after the complete tool-result group", () => {
  const history = attachmentHistory()
  const result = projectChatAttachmentRetrievals({
    history,
    catalogue: chatAttachmentCatalogue(history),
    messages: Array.from({ length: 6 }, () => projectChatModelHistory(history).at(-1)!),
    media: { protocol: "chat-completions", openRouterDocuments: true },
  })
  expect(result.messages.map((message) => message.role)).toEqual([
    ...Array.from({ length: 6 }, () => "tool"),
    "user",
    "user",
  ])
  expect(result.messages.slice(-2).map((message) => message.content?.length)).toEqual([5, 1])
})

test("only a server result linked to an original upload on this ancestry expands", () => {
  expect(chatAttachmentInputFileIds(attachmentHistory())).toEqual([FILE_ID, FILE_ID])
  const valid = attachmentProjection()
  expect(valid.trustedToolMessageIds).toEqual(new Set(["result:result-part"]))
  expect(valid.messages[1]?.content).toContainEqual({
    type: "document",
    source: { type: "file", value: FILE_ID, mimeType: "application/pdf" },
    metadata: { filename: "report.pdf" },
  })
  for (const history of [
    attachmentHistory().slice(1),
    attachmentHistory({ executionLocation: "browser" }),
    attachmentHistory({ name: "untrusted_tool" }),
    attachmentHistory({ toolSource: "mcp" }),
    attachmentHistory({ authorTenantUserId: "caller" }),
    attachmentHistory({ responseTargetId: "other-slot" }),
  ]) {
    expect(attachmentProjection(history).trustedToolMessageIds.size).toBe(0)
    expect(chatAttachmentInputFileIds(history)).toEqual(
      history[0]?.role === "user" ? [FILE_ID] : [],
    )
  }
})

test("media normalization accepts only trusted tool results and preserves their position", () => {
  const first = attachmentProjection()
  const hydrated = hydrateAttachmentFixture(first.messages)
  expect(normalizeChatAttachments(hydrated, { sandbox: false }).attachments[0]?.result).toBe(
    "rejected",
  )
  const normalized = normalizeChatAttachments(hydrated, {
    sandbox: false,
    trustedToolMessageIds: first.trustedToolMessageIds,
  })
  expect(normalized.attachments[0]?.result).toBe("pdf")
  expect(normalized.messages.map((message) => message.metadata)).toEqual(
    hydrated.map((message) => message.metadata),
  )
  const openRouter = attachmentProjection(attachmentHistory(), "chat-completions", true)
  expect(openRouter.messages.map((message) => message.role)).toEqual(["assistant", "tool", "user"])
  expect(openRouter.messages[2]?.metadata).toEqual(openRouter.messages[1]?.metadata)
})

test("retrieval reserves the aggregate budget across concurrent reads before returning references", async () => {
  const existing = Buffer.alloc(8 * 1024 * 1024)
  existing.write("%PDF-1.7")
  const selected = await prepareAttachmentFixture(attachmentHistory(), existing.toString("base64"))
  const bytes = Buffer.alloc(3 * 1024 * 1024)
  bytes.write("%PDF-1.7")
  const tools = createChatAttachmentTools([], {
    ...selected,
    media: { protocol: "responses" },
    read: () => Promise.resolve({ bytes, mimeType: "application/pdf" }),
  })
  const results: unknown[] = await Promise.all(
    [1, 2].map(() => Promise.resolve<unknown>(tools[0]!.execute!({ fileId: FILE_ID }))),
  )
  expect(results[0]).toHaveProperty("type", "attachment-reference")
  expect(results[1]).toHaveProperty("refusal")
})

test("SVG recovery pages historical text and prepares its sandbox path before returning", async () => {
  const prepare = vi.fn(() => Promise.resolve())
  const tools = createChatAttachmentTools([], {
    catalogue: chatAttachmentCatalogue(attachmentHistory()).map((file) => ({
      ...file,
      mimeType: "image/svg+xml",
      filename: "drawing.svg",
    })),
    remainingBytes: 0,
    prepare,
    media: { protocol: "responses" },
    read: () =>
      Promise.resolve({ bytes: Buffer.from("<svg>saved source</svg>"), mimeType: "image/svg+xml" }),
  })
  expect(await tools[0]!.execute!({ fileId: FILE_ID, offset: 5, limit: 5 })).toMatchObject({
    content: "saved",
    nextOffset: 10,
    sandboxPath: `uploads/${FILE_ID}-drawing.svg`,
  })
  expect(prepare).toHaveBeenCalledWith(
    expect.objectContaining({ sandboxPath: `uploads/${FILE_ID}-drawing.svg` }),
  )
})

test("file IDs are ancestry scoped, listing is bounded, and unsupported PDF is refused before reading", async () => {
  const catalogue = chatAttachmentCatalogue(attachmentHistory())
  const read = vi.fn(() =>
    Promise.resolve({
      bytes: Buffer.from(PDF, "base64"),
      mimeType: "application/pdf",
    }),
  )
  const recovery = {
    catalogue,
    remainingBytes: CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
    read,
    media: { protocol: "responses" },
  }
  const tools = createChatAttachmentTools([], recovery)
  const result: unknown = await tools[0]!.execute!({ fileId: FILE_ID })
  expect(result).toMatchObject({
    type: "attachment-reference",
    fileId: FILE_ID,
    sourceMessageId: "upload",
  })
  expect(JSON.stringify(result)).not.toContain(PDF)
  await tools[0]!.execute!({ fileId: "0199b600-0000-7000-8000-000000000099" })
  expect(read).toHaveBeenCalledTimes(1)
  const unsupported = createChatAttachmentTools([], {
    ...recovery,
    media: { protocol: "chat-completions" },
  })
  expect(await unsupported[0]!.execute!({ fileId: FILE_ID })).toHaveProperty("refusal")
  expect(read).toHaveBeenCalledTimes(1)
  const listed = createChatAttachmentTools([], {
    ...recovery,
    catalogue: Array.from({ length: 70 }, (_, index) => ({ ...catalogue[0]!, fileId: `${index}` })),
  })
  const page: unknown = await listed[1]!.execute!({ limit: 500 })
  expect(page).toHaveProperty("attachments.length", 50)
  expect(page).toHaveProperty("nextOffset", 50)
})

test.each`
  api                          | providerType    | mediaType     | resultWire                         | mediaWire
  ${"responses"}               | ${"openai"}     | ${"document"} | ${'"type":"function_call_output"'} | ${'"type":"input_file"'}
  ${"anthropic-messages"}      | ${"anthropic"}  | ${"document"} | ${'"type":"tool_result"'}          | ${'"type":"document"'}
  ${"gemini-generate-content"} | ${"google"}     | ${"document"} | ${'"functionResponse":'}           | ${'"inlineData":'}
  ${"chat-completions"}        | ${"openai"}     | ${"image"}    | ${'"role":"tool"'}                 | ${'"type":"image_url"'}
  ${"chat-completions"}        | ${"openrouter"} | ${"document"} | ${'"role":"tool"'}                 | ${'"type":"file"'}
`(
  "serializes retrieved $mediaType once on $providerType $api",
  async (
    route: Pick<ChatModelConfiguration, "api" | "providerType"> & {
      mediaType: "image" | "document"
      resultWire: string
      mediaWire: string
    },
  ) => {
    const openRouterDocuments = route.providerType === "openrouter"
    const history = attachmentHistory({ mediaType: route.mediaType })
    const projection = attachmentProjection(history, route.api, openRouterDocuments)
    const messages = hydrateAttachmentFixture(projection.messages)
    const requests: string[] = []
    const configuration: ChatModelConfiguration = {
      ...MODEL,
      api: route.api,
      providerType: route.providerType,
      providerName: "test",
      apiKey: "unused-test-key",
      baseUrl: "https://provider.example/v1",
      fetch: async (input, init) => {
        const encoded =
          typeof init?.body === "string"
            ? init.body
            : input instanceof Request
              ? await input.text()
              : ""
        requests.push(encoded)
        return Response.json({ error: { message: "Synthetic response" } }, { status: 401 })
      },
    }
    const adapter = createChatAdapter(
      configuration,
      openRouterDocuments ? chatWebState() : undefined,
    )
    for await (const _event of chat({ threadId: "retrieval-test", adapter, messages })) {
      // Exercise the installed serializers up to the synthetic provider boundary.
    }
    expect(requests).toHaveLength(1)
    const request = requests[0]!
    expect(request.split(PDF)).toHaveLength(2)
    expect(request).toContain(route.resultWire)
    expect(request).toContain(route.mediaWire)
  },
)
