import type { DraftAttachment } from "./types.ts"
import { newUuid } from "../../core/threads.ts"

let draftSessionId: string | undefined

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
    if (text === undefined) return globalThis.localStorage?.getItem(key) ?? ""
    if (text) globalThis.localStorage?.setItem(key, text)
    else globalThis.localStorage?.removeItem(key)
  } catch {
    // Disabled or full browser storage must not prevent editing or sending.
  }
  return ""
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
