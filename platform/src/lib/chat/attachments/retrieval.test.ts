import { chat, type ContentPart, type ModelMessage } from "@tanstack/ai"
import { Effect, Schema } from "effect"
import { expect, test, vi } from "vitest"

import { APP_HANDLE } from "@/lib/constants"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { createChatAdapter } from "../adapter"
import { projectChatModelHistory } from "../threads/projection"
import { chatWebState } from "../web"
import { normalizeChatAttachments } from "./attachments"
import {
  chatAttachmentCatalogue,
  projectChatAttachmentRetrievals,
  type ChatAttachmentHistoryRecord,
} from "./retrieval"
import { createChatAttachmentTools } from "./tools"
import { prepareChatProviderHistory, selectChatProviderHistory } from "./provider-history"
import { CHAT_ATTACHMENT_MAX_BYTES_BY_KIND, CHAT_ATTACHMENT_MAX_COUNT } from "./constants"

const FILE_ID = "0199b600-0000-7000-8000-000000000001"
const PDF = Buffer.from("%PDF-1.7").toString("base64")

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
): ChatAttachmentHistoryRecord[] {
  return [
    {
      id: "upload",
      role: "user",
      state: "complete",
      payload: {
        version: 1,
        parts: [
          {
            id: "file-part",
            type: options.mediaType ?? "document",
            metadata: { filename: "report.pdf" },
            source: {
              type: APP_HANDLE,
              id: FILE_ID,
              mimeType: options.mediaType === "image" ? "image/png" : "application/pdf",
              byteSize: options.bytes ?? 8,
            },
          },
        ],
      },
    },
    {
      id: "decision",
      role: "assistant",
      state: "complete",
      payload: {
        version: 1,
        parts: [
          {
            id: "tool-part",
            type: "tool-call",
            name: options.name ?? "read_attachment",
            toolCallId: "read_1",
            arguments: JSON.stringify({ fileId: FILE_ID }),
            executionLocation: options.executionLocation ?? "server_api",
            declaration: { source: options.toolSource ?? "chat-attachment" },
            targets: [{ id: "slot" }],
          },
        ],
      },
    },
    {
      id: "result",
      role: "tool",
      state: "complete",
      sourceAssistantMessageId: "decision",
      sourceToolPartId: "tool-part",
      responseTargetId: options.responseTargetId ?? "slot",
      authorTenantUserId: options.authorTenantUserId ?? null,
      payload: {
        version: 1,
        parts: [
          {
            id: "result-part",
            type: "tool-result",
            toolCallId: "read_1",
            outcome: "succeeded",
            output: {
              type: "attachment-reference",
              version: 1,
              fileId: FILE_ID,
              sourceMessageId: "upload",
            },
          },
        ],
      },
    },
  ]
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

test("media budgeting counts repeated retrieval bytes only in selected messages", () => {
  const history = attachmentHistory({ bytes: CHAT_ATTACHMENT_MAX_BYTES_BY_KIND.pdf })
  const messages = projectChatModelHistory(history)
  const options = {
    history,
    messages,
    model: {
      providerId: "provider",
      api: "responses",
      modelId: "model",
      providerType: "openai",
    } as const,
    webAccessEnabled: false,
  }
  expect(selectChatProviderHistory(options)).not.toBeNull()
  expect(
    selectChatProviderHistory({ ...options, messages: [...messages, messages.at(-1)!] }),
  ).toBeNull()
  expect(selectChatProviderHistory({ ...options, messages: messages.slice(1) })).not.toBeNull()
})

test("media budgeting retains the per-message attachment count cap", () => {
  const history = attachmentHistory()
  const upload = projectChatModelHistory(history)[0]!
  const content = upload.content as ContentPart[]
  const options = {
    history,
    model: {
      providerId: "provider",
      api: "responses",
      modelId: "model",
      providerType: "openai",
    } as const,
    webAccessEnabled: false,
  }
  const messages = [
    { ...upload, content: Array.from({ length: CHAT_ATTACHMENT_MAX_COUNT }, () => content[0]!) },
  ]
  expect(selectChatProviderHistory({ ...options, messages })).not.toBeNull()
  messages[0]!.content.push(content[0]!)
  expect(selectChatProviderHistory({ ...options, messages })).toBeNull()
})

test("only a server result linked to an original upload on this ancestry expands", () => {
  const valid = attachmentProjection()
  expect(valid.trustedToolMessageIds).toEqual(new Set(["result:result-part"]))
  expect(valid.messages[1]?.content).toEqual([
    {
      type: "text",
      content: JSON.stringify({
        type: "attachment-reference",
        version: 1,
        fileId: FILE_ID,
        sourceMessageId: "upload",
      }),
    },
    {
      type: "document",
      source: { type: "file", value: FILE_ID, mimeType: "application/pdf" },
      metadata: { filename: "report.pdf" },
    },
  ])
  for (const history of [
    attachmentHistory().slice(1),
    attachmentHistory({ executionLocation: "browser" }),
    attachmentHistory({ name: "untrusted_tool" }),
    attachmentHistory({ toolSource: "mcp" }),
    attachmentHistory({ authorTenantUserId: "caller" }),
    attachmentHistory({ responseTargetId: "other-slot" }),
  ]) {
    expect(attachmentProjection(history).trustedToolMessageIds.size).toBe(0)
  }
})

test("media retrieval remains stable on reload and validates only trusted tool media", () => {
  const first = attachmentProjection()
  expect(attachmentProjection()).toEqual(first)
  const hydrated = first.messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) =>
          part.type === "document"
            ? {
                ...part,
                source: { type: "data" as const, value: PDF, mimeType: "application/pdf" },
              }
            : part,
        )
      : message.content,
  }))
  expect(normalizeChatAttachments(hydrated, { sandbox: false }).attachments[0]?.result).toBe(
    "rejected",
  )
  expect(
    normalizeChatAttachments(hydrated, {
      sandbox: false,
      trustedToolMessageIds: first.trustedToolMessageIds,
    }).attachments[0]?.result,
  ).toBe("pdf")
  expect(
    normalizeChatAttachments(hydrated, {
      sandbox: false,
      trustedToolMessageIds: first.trustedToolMessageIds,
    }).messages.map((message) => message.metadata),
  ).toEqual(hydrated.map((message) => message.metadata))
  const openRouter = attachmentProjection(attachmentHistory(), "chat-completions", true)
  expect(openRouter.messages.map((message) => message.role)).toEqual(["assistant", "tool", "user"])
  expect(openRouter.messages[2]?.metadata).toEqual(openRouter.messages[1]?.metadata)
})

test("provider preparation hydrates only the selected messages", async () => {
  const history = attachmentHistory()
  const hydrated: string[] = []
  await Effect.runPromise(
    prepareChatProviderHistory({
      selected: selectChatProviderHistory({
        history,
        messages: [{ id: "selected", role: "user", content: "Selected context" }],
        model: {
          api: "responses",
          providerType: "openai",
          providerId: "provider",
          modelId: "model",
        },
        webAccessEnabled: false,
      })!,
      files: {
        hydrate: ({ messages }) => {
          hydrated.push(...messages.map((message) => message.id ?? ""))
          return Effect.succeed([...messages])
        },
      },
      sandbox: false,
      scope: { organizationId: "org", tenantId: "tenant", threadId: "thread" },
    }),
  )
  expect(hydrated).toEqual(["selected"])
})

test("historical sandbox recovery prepares a stable unique file before returning its path", async () => {
  const catalogue = chatAttachmentCatalogue(attachmentHistory()).map((file) => ({
    ...file,
    filename: "notes.txt",
    mimeType: "text/plain",
  }))
  const prepared: string[] = []
  const tools = createChatAttachmentTools([], {
    catalogue,
    media: { protocol: "responses" },
    read: () => Promise.resolve({ bytes: Buffer.from("saved text"), mimeType: "text/plain" }),
    prepare: (file) => {
      prepared.push(file.sandboxPath ?? "")
      return Promise.resolve()
    },
  })
  const result: unknown = await tools[0]!.execute!({ fileId: FILE_ID })
  expect(result).toMatchObject({
    content: "saved text",
    sandboxPath: `uploads/${FILE_ID}-notes.txt`,
  })
  expect(prepared).toEqual([`uploads/${FILE_ID}-notes.txt`])
})

test("file IDs are ancestry scoped, listing is bounded, and unsupported PDF is refused before reading", async () => {
  const catalogue = chatAttachmentCatalogue(attachmentHistory())
  const read = vi.fn(() =>
    Promise.resolve({
      bytes: Buffer.from(PDF, "base64"),
      mimeType: "application/pdf",
    }),
  )
  const tools = createChatAttachmentTools([], { catalogue, read, media: { protocol: "responses" } })
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
    catalogue,
    read,
    media: { protocol: "chat-completions" },
  })
  expect(await unsupported[0]!.execute!({ fileId: FILE_ID })).toHaveProperty("refusal")
  expect(read).toHaveBeenCalledTimes(1)
  const listed = createChatAttachmentTools([], {
    catalogue: Array.from({ length: 70 }, (_, index) => ({ ...catalogue[0]!, fileId: `${index}` })),
    read,
    media: { protocol: "responses" },
  })
  const page = Schema.decodeUnknownSync(
    Schema.Struct({ attachments: Schema.Array(Schema.JsonObject), nextOffset: Schema.Number }),
  )(await listed[1]!.execute!({ limit: 500 }))
  expect(page.attachments).toHaveLength(50)
  expect(page.nextOffset).toBe(50)
})

test.each([
  {
    api: "responses",
    providerType: "openai",
    mediaType: "document",
    openRouterDocuments: false,
    resultWire: '"type":"function_call_output"',
    mediaWire: '"type":"input_file"',
  },
  {
    api: "anthropic-messages",
    providerType: "anthropic",
    mediaType: "document",
    openRouterDocuments: false,
    resultWire: '"type":"tool_result"',
    mediaWire: '"type":"document"',
  },
  {
    api: "gemini-generate-content",
    providerType: "google",
    mediaType: "document",
    openRouterDocuments: false,
    resultWire: '"functionResponse":',
    mediaWire: '"inlineData":',
  },
  {
    api: "chat-completions",
    providerType: "openai",
    mediaType: "image",
    openRouterDocuments: false,
    resultWire: '"role":"tool"',
    mediaWire: '"type":"image_url"',
  },
  {
    api: "chat-completions",
    providerType: "openrouter",
    mediaType: "document",
    openRouterDocuments: true,
    resultWire: '"role":"tool"',
    mediaWire: '"type":"file"',
  },
] as const)("serializes retrieved $mediaType once on $providerType $api", async (route) => {
  const history = attachmentHistory({ mediaType: route.mediaType })
  const projection = attachmentProjection(history, route.api, route.openRouterDocuments)
  const messages: ModelMessage[] = projection.messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) =>
          part.type !== "text"
            ? {
                ...part,
                source: {
                  type: "data",
                  value: PDF,
                  mimeType: route.mediaType === "image" ? "image/png" : "application/pdf",
                },
              }
            : part,
        )
      : message.content,
  }))
  const requests: (typeof Schema.JsonObject.Type)[] = []
  const configuration: ChatModelConfiguration = {
    api: route.api,
    providerType: route.providerType,
    providerId: "provider",
    providerName: "test",
    modelId: "custom-model",
    apiKey: "unused-test-key",
    baseUrl: "https://provider.example/v1",
    fetch: async (input, init) => {
      const encoded =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.text()
            : ""
      const body = Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(encoded))
      requests.push(body)
      return Response.json({ error: { message: "Synthetic response" } }, { status: 401 })
    },
  }
  const adapter = createChatAdapter(
    configuration,
    route.openRouterDocuments ? chatWebState() : undefined,
  )
  for await (const _event of chat({ threadId: "retrieval-test", adapter, messages })) {
    // Exercise the installed serializers up to the synthetic provider boundary.
  }
  expect(requests).toHaveLength(1)
  const request = requests[0]!
  expect(JSON.stringify(request).split(PDF)).toHaveLength(2)
  expect(JSON.stringify(request)).toContain(route.resultWire)
  expect(JSON.stringify(request)).toContain(route.mediaWire)
})
