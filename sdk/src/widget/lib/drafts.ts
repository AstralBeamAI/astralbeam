import type { DraftAttachment } from "./types.ts"

function draftStorageKey(apiUrl: string, identity: string, threadId: string): string {
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

function openAttachmentDatabase(): Promise<IDBDatabase> {
  attachmentDatabase ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("astralbeam:drafts", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("attachments")
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

// IndexedDB keeps file contents beyond Web Storage's small string quota.
// https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
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
      if (update) attachments = update(attachments).filter((file) => file.status === "ready")
      if (moveTo !== undefined) {
        if (attachments.length) store.put(attachments, draftStorageKey(apiUrl, identity, moveTo))
        store.delete(key)
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
