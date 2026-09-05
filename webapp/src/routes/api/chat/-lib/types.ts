import type { chatParamsFromRequest } from "@tanstack/ai"

import type { ChatTokenPayloadSchema } from "@/lib/schemas"
import type { AttachmentTable } from "./attachment-profile.server"

export type ChatParams = Awaited<ReturnType<typeof chatParamsFromRequest>>
export type ChatMessages = ChatParams["messages"]

/**
 * What an attachment is, which decides how it reaches the model: an `image` or a `pdf` is a
 * modality the provider reads itself, and everything else is a file the agent reads with
 * `read_attachment` or opens in the sandbox.
 */
export type ChatAttachmentKind = "image" | "pdf" | "text" | "data" | "office"

/** What became of one attachment on a run, for the debug log. */
export interface ChatAttachmentOutcome {
  filename: string
  mimeType: string
  /** Decoded size; zero for a refused attachment, which is never decoded. */
  bytes: number
  result: ChatAttachmentKind | "rejected"
  /** The name the agent reads the file by; absent for a native or refused attachment. */
  handle?: string
  reason?: string
}

/**
 * One attached file the run carries. The bytes are decoded once, here, and serve both reads: the
 * `read_attachment` tool pages through `text`, and the sandbox writes `bytes` to `sandboxPath`.
 */
export interface ChatAttachmentFile {
  /** Unique within the run, and the basename of {@link sandboxPath}. */
  readonly handle: string
  readonly filename: string
  readonly mimeType: string
  readonly bytes: Uint8Array
  /** The text view of the file; absent when it has none, such as a Parquet file. */
  readonly text?: string
  /** {@link text} stops short of the whole file. */
  readonly truncated?: boolean
  /** Tables the file holds: one for a delimited file, one per sheet for a workbook. */
  readonly tables?: readonly AttachmentTable[]
  /** Countable divisions the agent can cite, such as a deck's slides. */
  readonly sections?: { readonly label: string; readonly count: number }
  /** Where the file is written in the sandbox; absent when the agent has no sandbox. */
  readonly sandboxPath?: string
}

export type DebugLog = (category: string, summary: string, data?: unknown) => void

/**
 * Sandbox provisioning progress. Streamed as a CUSTOM event because it is the one thing a tool
 * result cannot report in time: the widget needs it while the sandbox is still starting.
 */
export type ChatSandboxStatus = { readonly state: "starting" | "ready" | "error" }

export interface ChatAuthenticationError extends Error {
  code: "invalid_token"
}

type ChatTokenPayload = typeof ChatTokenPayloadSchema.Type

export type ChatTenantUser = ChatTokenPayload["user"] & {
  readonly tenant: ChatTokenPayload["tenant"]
}

export interface ChatPrincipal {
  readonly organization: { readonly id: string }
  readonly tenantUser: ChatTenantUser
}
