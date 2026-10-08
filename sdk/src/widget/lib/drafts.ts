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

export function storedThreadDraft(
  apiUrl: string,
  identity: string,
  threadId: string,
  text?: string,
): string {
  if (!identity) return ""
  const key = `astralbeam:draft:${draftStorageKey(apiUrl, identity, threadId)}`
  try {
    if (text === undefined) return globalThis.localStorage?.getItem(key) ?? ""
    if (text) globalThis.localStorage?.setItem(key, text)
    else globalThis.localStorage?.removeItem(key)
  } catch {
    // Disabled or full browser storage must not prevent editing or sending.
  }
  return ""
}

let attachmentDatabase: Promise<IDBDatabase> | undefined

function storedAttachment(file: DraftAttachment): DraftAttachment {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
    kind: file.kind,
    sessionId: file.sessionId,
    sha256: file.sha256,
    fileId: file.fileId,
    status: file.fileId ? "ready" : "reselect",
  }
}

function openAttachmentDatabase(): Promise<IDBDatabase> {
  attachmentDatabase ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("astralbeam:drafts", 2)
    request.onupgradeneeded = () => {
      if (request.result.objectStoreNames.contains("attachments")) {
        request.result.deleteObjectStore("attachments")
      }
      request.result.createObjectStore("attachments")
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        attachmentDatabase = undefined
      }
      resolve(database)
    }
    request.onerror = () => reject(request.error ?? new Error("Draft storage is unavailable"))
    request.onblocked = () => reject(new Error("Draft storage is unavailable"))
  }).catch((error: unknown) => {
    attachmentDatabase = undefined
    throw error
  })
  return attachmentDatabase
}

// Draft recovery retains session identifiers and fingerprints, never file bytes or signed URLs.
export async function storedThreadAttachments({
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
  if (!identity) return []
  const database = await openAttachmentDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      "attachments",
      update || moveTo ? "readwrite" : "readonly",
    )
    const store = transaction.objectStore("attachments")
    const key = draftStorageKey(apiUrl, identity, threadId)
    const request = store.get(key)
    let attachments: DraftAttachment[] = []
    request.onsuccess = () => {
      attachments = (request.result as DraftAttachment[] | undefined) ?? []
      if (update)
        attachments = update(attachments)
          .filter((file) => file.kind !== undefined)
          .map(storedAttachment)
      if (moveTo !== undefined) {
        const destinationKey = draftStorageKey(apiUrl, identity, moveTo)
        const destination = store.get(destinationKey)
        destination.onsuccess = () => {
          attachments = [
            ...new Map(
              [
                ...((destination.result as DraftAttachment[] | undefined) ?? []),
                ...attachments,
              ].map((file) => [file.id, file]),
            ).values(),
          ]
          if (attachments.length) store.put(attachments, destinationKey)
          store.delete(key)
        }
      } else if (update) {
        if (attachments.length) store.put(attachments, key)
        else store.delete(key)
      }
    }
    transaction.oncomplete = () => resolve(attachments)
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Draft storage is unavailable"))
  })
}
