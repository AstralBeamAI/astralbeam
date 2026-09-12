import { type AnyServerTool, chat, mergeAgentTools } from "@tanstack/ai"

import { runDatabaseEffect } from "@/db"
import { readOrganizationOpenaiApiKey } from "@/db/organization-openai-api-key.server"
import { createChatAdapter } from "./adapter.server"
import { resolveChatAgent } from "./agent.server"
import { createChatAttachmentTools } from "./attachment-tools.server"
import {
  createChatAttachmentSnapshotMiddleware,
  normalizeChatAttachments,
  redactChatAttachmentData,
} from "./attachments.server"
import {
  CHAT_ATTACHMENT_SYSTEM_PROMPT,
  CHAT_SANDBOX_ARTIFACT_SYSTEM_PROMPT,
  CHAT_SANDBOX_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
} from "./constants.server"
import { createDebugLog, withDebugLog } from "./debug.server"
import { resolveChatSandboxSession } from "./sandbox.server"
import { createChatSandboxTools } from "./sandbox-tools.server"
import type { ChatParams, ChatPrincipal } from "./types"
import { chatError } from "./errors.server"

export async function createChatRun(
  params: ChatParams,
  principal: ChatPrincipal,
) {
  const openaiApiKey = await runDatabaseEffect(
    readOrganizationOpenaiApiKey(principal.organization.id),
  )
  const { agentId, systemPrompt, debug } = params.forwardedProps
  const selectedAgent = await resolveChatAgent(agentId, principal.organization.id)
  if (!selectedAgent) {
    throw chatError(
      "NotFound",
      agentId === undefined || agentId === null
        ? "This organization has no default agent; pass an agentId or set a default."
        : "Agent not found.",
    )
  }
  // Instructions are agent configuration: a browser-supplied prompt would let any tenant
  // user rewrite them from devtools, so the endpoint refuses rather than ignores it.
  if (systemPrompt !== undefined && systemPrompt !== null) {
    throw chatError(
      "InvalidInput",
      "The system prompt is agent configuration; set it in the dashboard.",
    )
  }
  // The SDK's `debug` mount option rides along in the forwarded props and its log prints
  // whole conversations, so — like the `systemPrompt` refused above — it is DEV-only.
  const log = debug === true && import.meta.env.DEV ? createDebugLog(params.runId) : undefined
  if (log) {
    log("request", `POST /api/v1/chat, ${params.messages.length} messages`, {
      threadId: params.threadId,
      runId: params.runId,
      parentRunId: params.parentRunId,
      resume: params.resume,
      agentId,
      debug,
    })
    log("request", "conversation messages", redactChatAttachmentData(params.messages))
    log("request", `client-declared tools (${params.tools.length})`, params.tools)
  }
  if (!openaiApiKey) {
    throw chatError("Unavailable", "Org OpenAI key is not configured")
  }
  // Attachments are rewritten into what the model reads before the run starts: the
  // provider adapter throws on a content part it cannot map, which would fail the whole
  // run over one unsupported file. Whether the agent has a sandbox changes the delivery,
  // so it is resolved first: a file with no text view has nowhere to go without one.
  const { messages, attachments, files } = normalizeChatAttachments(params.messages, {
    sandbox: selectedAgent.sandboxProviderId !== null,
  })
  // Agent capability policy, enforced here regardless of what the client narrowed.
  if (!selectedAgent.attachmentsEnabled && attachments.length > 0) {
    throw chatError("InvalidInput", "This agent does not accept file attachments.")
  }
  if (log && attachments.length > 0) {
    log("attachment", `${attachments.length} attachment(s) normalized`, attachments)
  }
  // The agent's sandbox, when it has one. Resolving it is one database read and builds no
  // sandbox: the tools provision one only if the agent actually reaches for them.
  let sandboxTools: AnyServerTool[] = []
  if (selectedAgent.sandboxProviderId) {
    try {
      const session = await runDatabaseEffect(resolveChatSandboxSession({
        sandboxProviderId: selectedAgent.sandboxProviderId,
        agentId: selectedAgent.id,
        principal,
        threadId: params.threadId,
        runId: params.runId,
        uploads: files,
      }))
      sandboxTools = createChatSandboxTools({
        session,
        log,
        artifactScope: {
          organizationId: principal.organization.id,
          tenantId: principal.tenantUser.tenant.id,
          tenantUserId: principal.tenantUser.id,
          sandboxProviderId: selectedAgent.sandboxProviderId,
        },
      })
      log?.("sandbox", `${sandboxTools.length} sandbox tools declared`)
    } catch (error) {
      // Degrade rather than refuse the reply: an unreadable provider configuration is the
      // organization's problem and the agent is still useful without a sandbox. Its tools
      // and its prompt drop together, so it never offers a capability it does not have.
      console.error("Failed to prepare the /api/v1/chat sandbox:", error)
    }
  }
  // Declared only when the run carries files, so an agent is never offered a reader with
  // nothing to read; the tool serves the bytes already decoded in `files`.
  const attachmentTools = createChatAttachmentTools({ files, log })
  const abortController = new AbortController()
  const stream = chat({
    adapter: createChatAdapter(openaiApiKey),
    messages,
    systemPrompts: [
      CHAT_SYSTEM_PROMPT,
      // Only the generic policy: what each attached file is reaches the model through
      // `read_attachment`, so nothing a file chose to say lands at deployment authority.
      ...(files.length > 0 ? [CHAT_ATTACHMENT_SYSTEM_PROMPT] : []),
      ...(sandboxTools.length > 0
        ? [CHAT_SANDBOX_SYSTEM_PROMPT, CHAT_SANDBOX_ARTIFACT_SYSTEM_PROMPT]
        : []),
      selectedAgent.systemPrompt,
    ],
    // Every other tool executes in the host page and arrives declared in the request body;
    // a client tool reusing a server tool's name is dropped by `mergeAgentTools`.
    tools: mergeAgentTools([...sandboxTools, ...attachmentTools], params.tools),
    // The client rebuilds its transcript from the snapshot an interrupt boundary emits,
    // so the turns it sent have to survive the rewrite above.
    middleware: [createChatAttachmentSnapshotMiddleware(params.messages)],
    threadId: params.threadId,
    runId: params.runId,
    parentRunId: params.parentRunId,
    resume: params.resume,
    modelOptions: { reasoning: { effort: "high" } },
    abortController,
  })
  return { stream: log ? withDebugLog(stream, log) : stream, abortController }
}
