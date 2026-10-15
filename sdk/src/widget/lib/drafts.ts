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
    const read = (key: string): DraftAttachment[] =>
      JSON.parse(globalThis.localStorage?.getItem(key) ?? "[]") as DraftAttachment[]
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
      globalThis.localStorage?.setItem(
        destinationKey,
        JSON.stringify(attachments.map(({ data: _data, ...file }) => file)),
      )
      globalThis.localStorage?.removeItem(key)
    } else if (update) {
      if (attachments.length)
        globalThis.localStorage?.setItem(
          key,
          JSON.stringify(attachments.map(({ data: _data, ...file }) => file)),
        )
      else globalThis.localStorage?.removeItem(key)
    }
    return attachments
  }
  return globalThis.navigator?.locks
    ? navigator.locks.request("astralbeam:attachment-drafts", applyChanges)
    : Promise.resolve().then(applyChanges)
}
