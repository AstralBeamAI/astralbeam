import { chatPlacementKey, newUuid } from "../core/threads.ts"
import type { MultimodalContent } from "@tanstack/ai-client"

/**
 * What an attachment is. An `image` or a `pdf` the agent's model reads directly; a `text`, `data`,
 * or `office` file is described to the agent, which then reads or analyzes it as a file. The kind
 * also picks the size cap and the icon, which is why the office formats are not simply `data`.
 */
export type AttachmentKind = "image" | "pdf" | "text" | "data" | "office"

/**
 * One file the user picked, before it is sent. A rejected file is kept as a `status: "error"`
 * entry so the composer can say why instead of dropping it silently, and carries no `kind`.
 */
export interface DraftAttachment {
  id: string
  name: string
  /** Size in bytes as reported by the file, used for the label and the caps. */
  size: number
  mimeType: string
  kind?: AttachmentKind
  status: "reading" | "ready" | "error"
  /** Uploaded object ID. Only this reference and file metadata are persisted locally. */
  fileId?: string
  /** Why the file was rejected or could not be read; present when the status is `"error"`. */
  error?: string
}

let draftSessionId: string | undefined

export function chatDraftIdentity(
  identity: string,
  options: Parameters<typeof chatPlacementKey>[0],
): string {
  return JSON.stringify([identity, chatPlacementKey(options)])
}

function draftStorageKey(apiUrl: string, identity: string, threadId: string): string {
  if (!threadId) {
    if (!draftSessionId) {
      try {
        const key = "astralbeam:draft-session"
        draftSessionId = globalThis.sessionStorage?.getItem(key) ?? newUuid()
        globalThis.sessionStorage?.setItem(key, draftSessionId)
      } catch {
        draftSessionId ??= newUuid()
      }
    }
    threadId = `new:${draftSessionId}`
  }
  return JSON.stringify([apiUrl.replace(/\/+$/, ""), identity, threadId])
}

function isStoredDraftAttachment(file: unknown): file is DraftAttachment {
  return (
    typeof file === "object" &&
    file !== null &&
    "id" in file &&
    typeof file.id === "string" &&
    "name" in file &&
    typeof file.name === "string" &&
    "size" in file &&
    typeof file.size === "number" &&
    Number.isFinite(file.size) &&
    file.size >= 0 &&
    "mimeType" in file &&
    typeof file.mimeType === "string" &&
    "status" in file &&
    file.status === "ready" &&
    "fileId" in file &&
    typeof file.fileId === "string" &&
    (!("kind" in file) ||
      (typeof file.kind === "string" &&
        ["image", "pdf", "text", "data", "office"].includes(file.kind))) &&
    (!("error" in file) || typeof file.error === "string")
  )
}

/** Reads or writes unsent text, or with `sent`, the recovery copy of a send not yet accepted. */
export function storedThreadDraft(
  apiUrl: string,
  identity: string,
  threadId: string,
  text?: string,
  slot: "draft" | "sent" = "draft",
): string {
  if (!identity) return ""
  const key = `astralbeam:${slot}:${draftStorageKey(apiUrl, identity, threadId)}`
  try {
    const session = slot === "sent" ? globalThis.sessionStorage : undefined
    if (text === undefined)
      return session?.getItem(key) ?? globalThis.localStorage?.getItem(key) ?? ""
    if (text) (session ?? globalThis.localStorage)?.setItem(key, text)
    else session?.removeItem(key)
    // Older SDKs used localStorage for the recovery copy, even for saved conversations.
    if (session || !text) globalThis.localStorage?.removeItem(key)
  } catch {
    // Disabled or full browser storage must not prevent editing or sending.
  }
  return ""
}

export interface PendingSubmissionScope {
  apiUrl: string
  identity: string
  threadId: string
}

export interface PendingSubmission {
  id: string
  key: string
  content: string | MultimodalContent
  tools: Array<Record<string, unknown>>
  clientId: string
  dispatchedAt: number
  draftFileIds?: readonly string[] | undefined
}

// Keep only text and uploaded references, as with the rest of the composer draft.
function isRecoverableContent(content: string | MultimodalContent): boolean {
  return (
    typeof content === "string" ||
    typeof content.content === "string" ||
    (Array.isArray(content.content) &&
      content.content.every((part) =>
        part?.type === "text"
          ? typeof part.content === "string"
          : ["image", "document", "audio", "video"].includes(part?.type) &&
            part.source?.type === "file" &&
            typeof part.source.value === "string",
      ))
  )
}

/** A dispatched send belongs to this tab and verified account, placement, API, and thread. */
export function storedPendingSubmission(
  scope: PendingSubmissionScope,
  change?: { save: PendingSubmission } | { clearKey: string },
): PendingSubmission | undefined {
  if (!scope.identity || !scope.threadId) return
  const key = `astralbeam:pending:${draftStorageKey(scope.apiUrl, scope.identity, scope.threadId)}`
  try {
    const storage = globalThis.sessionStorage
    if (!storage) return
    if (change && "save" in change) {
      if (isRecoverableContent(change.save.content))
        storage.setItem(key, JSON.stringify(change.save))
      return
    }
    const pending = JSON.parse(storage.getItem(key) ?? "null") as PendingSubmission | null
    if (change) {
      if (pending?.key === change.clearKey) storage.removeItem(key)
      return
    }
    if (
      !pending ||
      typeof pending.id !== "string" ||
      typeof pending.key !== "string" ||
      typeof pending.clientId !== "string" ||
      !pending.content ||
      !isRecoverableContent(pending.content) ||
      !Number.isFinite(pending.dispatchedAt) ||
      !Array.isArray(pending.tools) ||
      (pending.draftFileIds !== undefined &&
        (!Array.isArray(pending.draftFileIds) ||
          !pending.draftFileIds.every((id) => typeof id === "string")))
    )
      return
    return pending
  } catch {
    // A disabled, full, or malformed store must not stop live sends and in-memory retries.
  }
  return undefined
}

// Drafts retain uploaded object references, never file bytes or signed URLs.
export function storedThreadAttachments({
  apiUrl,
  identity,
  threadId,
  update,
  moveTo,
}: {
  apiUrl: string
  identity: string
  threadId: string
  update?: (attachments: DraftAttachment[]) => DraftAttachment[]
  moveTo?: string
}): Promise<DraftAttachment[]> {
  // Web Locks serialize local-storage edits and moves across tabs sharing this origin.
  // https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
  const applyChanges = () => {
    if (!identity) return []
    const key = `astralbeam:attachments:${draftStorageKey(apiUrl, identity, threadId)}`
    const read = (key: string): DraftAttachment[] => {
      const files: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? "[]")
      if (!Array.isArray(files) || !files.every(isStoredDraftAttachment))
        throw new TypeError("Stored attachment draft is invalid")
      return files
    }
    let attachments = read(key)
    if (update)
      attachments = update(attachments).filter(
        (file) => file.status === "ready" && file.fileId !== undefined,
      )
    if (moveTo !== undefined) {
      const destinationKey = `astralbeam:attachments:${draftStorageKey(apiUrl, identity, moveTo)}`
      attachments = [
        ...new Map(
          [...read(destinationKey), ...attachments].map((file) => [file.id, file]),
        ).values(),
      ]
      globalThis.localStorage?.setItem(destinationKey, JSON.stringify(attachments))
      globalThis.localStorage?.removeItem(key)
    } else if (update) {
      if (attachments.length) globalThis.localStorage?.setItem(key, JSON.stringify(attachments))
      else globalThis.localStorage?.removeItem(key)
    }
    return attachments
  }
  return globalThis.navigator?.locks
    ? navigator.locks.request("astralbeam:attachment-drafts", applyChanges)
    : Promise.resolve().then(applyChanges)
}
