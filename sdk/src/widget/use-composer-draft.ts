import { useCallback, useEffect, useRef, useState } from "react"
import type { DebugLogger } from "../lib/debug.ts"
import { storedThreadAttachments, storedThreadDraft } from "./lib/drafts.ts"
import type { DraftAttachment } from "./lib/types.ts"

const EMPTY_ATTACHMENTS: DraftAttachment[] = []

interface ThreadDraft {
  text: string
  attachments: DraftAttachment[]
  /** The last list written to storage. A failed write settles the UI but keeps the saved baseline. */
  settledAttachments: DraftAttachment[]
  savedAttachments: DraftAttachment[]
  attachmentsLoaded: boolean
  storageError: boolean
}

const EMPTY_DRAFT: ThreadDraft = {
  text: "",
  attachments: EMPTY_ATTACHMENTS,
  settledAttachments: EMPTY_ATTACHMENTS,
  savedAttachments: EMPTY_ATTACHMENTS,
  attachmentsLoaded: false,
  storageError: false,
}
const storedDraft = (apiUrl: string, identity: string, threadId: string): ThreadDraft => ({
  ...EMPTY_DRAFT,
  text: storedThreadDraft(apiUrl, identity, threadId),
})

/**
 * The composer's unsent text and files per conversation, kept in local storage within one verified
 * identity and API scope. A sent message belongs to the session, and storage keeps its recovery
 * copy until the server accepts it.
 */
export function useComposerDraft({
  apiUrl,
  verifiedIdentity,
  threadId,
  canLoad,
  debug,
}: {
  apiUrl: string
  /** Undefined while authentication is pending, which keeps the previous identity's drafts. */
  verifiedIdentity: string | undefined
  threadId: string
  canLoad: boolean
  debug: DebugLogger | undefined
}) {
  const [drafts, setDrafts] = useState({
    apiUrl,
    identity: "",
    threads: new Map<string, ThreadDraft>(),
  })
  const identity = verifiedIdentity ?? drafts.identity
  if (drafts.apiUrl !== apiUrl || drafts.identity !== identity)
    setDrafts({ apiUrl, identity, threads: new Map() })
  const draft = drafts.threads.get(threadId) ?? storedDraft(apiUrl, identity, threadId)

  // Late uploads, writes, and send callbacks apply only within the scope that started them.
  const edit = useCallback(
    (
      key: string,
      transform: (
        draft: ThreadDraft,
        threads: ReadonlyMap<string, ThreadDraft>,
      ) => ThreadDraft | undefined,
    ) =>
      setDrafts((current) => {
        if (current.apiUrl !== apiUrl || current.identity !== identity) return current
        const value = current.threads.get(key) ?? storedDraft(apiUrl, identity, key)
        const next = transform(value, current.threads)
        if (next === value) return current
        const threads = new Map(current.threads)
        if (next) threads.set(key, next)
        else threads.delete(key)
        return { ...current, threads }
      }),
    [apiUrl, identity],
  )

  useEffect(() => {
    if (!canLoad || draft.attachmentsLoaded) return
    let cancelled = false
    void storedThreadAttachments({ apiUrl, identity, threadId })
      .then(
        (attachments) => ({ attachments, storageError: false }),
        () => ({ attachments: EMPTY_ATTACHMENTS, storageError: true }),
      )
      .then(({ attachments, storageError }) => {
        if (cancelled) return
        // A reload or a refused send returns text the server did not accept ahead of the draft.
        const sent = storedThreadDraft(apiUrl, identity, threadId, undefined, "sent")
        const unsent = storedThreadDraft(apiUrl, identity, threadId)
        const text = sent && unsent ? `${sent}\n\n${unsent}` : sent || unsent
        if (sent) {
          storedThreadDraft(apiUrl, identity, threadId, text)
          storedThreadDraft(apiUrl, identity, threadId, "", "sent")
        }
        edit(threadId, (value) => {
          if (value.attachmentsLoaded) return value
          const added = value.attachments.filter(
            (file) => !attachments.some((saved) => saved.id === file.id),
          )
          return {
            ...value,
            text,
            attachments: added.length ? [...attachments, ...added] : attachments,
            settledAttachments: attachments,
            savedAttachments: attachments,
            attachmentsLoaded: true,
            storageError,
          }
        })
      })
    return () => {
      cancelled = true
    }
  }, [apiUrl, identity, threadId, canLoad, draft.attachmentsLoaded, edit])

  // Changes apply by file ID so a stale tab cannot overwrite newer files or restore accepted ones.
  const pendingWrites = useRef(new Set<string>())
  useEffect(() => {
    for (const [key, value] of drafts.threads) {
      if (!value.attachmentsLoaded || value.attachments === value.settledAttachments) continue
      const scope = JSON.stringify([drafts.apiUrl, drafts.identity, key])
      if (pendingWrites.current.has(scope)) continue
      pendingWrites.current.add(scope)
      const finish = (storageError: boolean) => {
        pendingWrites.current.delete(scope)
        edit(key, (latest, threads) =>
          threads.has(key)
            ? {
                ...latest,
                settledAttachments: value.attachments,
                savedAttachments: storageError ? latest.savedAttachments : value.attachments,
                storageError,
              }
            : latest,
        )
      }
      void storedThreadAttachments({
        apiUrl: drafts.apiUrl,
        identity: drafts.identity,
        threadId: key,
        update: (files) => {
          const stored = new Map(files.map((file) => [file.id, file]))
          for (const file of value.savedAttachments) {
            if (!value.attachments.some((current) => current.id === file.id)) stored.delete(file.id)
          }
          for (const file of value.attachments) {
            if (
              file.status === "ready" &&
              !value.savedAttachments.some(
                (saved) => saved.id === file.id && saved.status === "ready",
              )
            )
              stored.set(file.id, file)
          }
          return [...stored.values()]
        },
      }).then(
        () => finish(false),
        () => finish(true),
      )
    }
  }, [drafts, edit])

  const clear = (key: string, keep?: ThreadDraft) => {
    storedThreadDraft(apiUrl, identity, key, "")
    storedThreadDraft(apiUrl, identity, key, "", "sent")
    void storedThreadAttachments({ apiUrl, identity, threadId: key, update: () => [] }).catch(
      (error: unknown) => debug?.("error", "Draft files could not be cleared", error),
    )
    edit(key, () => keep)
  }

  // The session keeps these callbacks with its submission, so a Retry settles the same one.
  const follow = (fileIds: ReadonlySet<string>, initialKey: string) => {
    let key = initialKey
    return {
      onThreadReady: (id: string) => {
        if (key !== "") return
        key = id
        for (const slot of ["draft", "sent"] as const) {
          const stored = storedThreadDraft(apiUrl, identity, "", undefined, slot)
          if (stored) storedThreadDraft(apiUrl, identity, id, stored, slot)
          storedThreadDraft(apiUrl, identity, "", "", slot)
        }
        void storedThreadAttachments({ apiUrl, identity, threadId: "", moveTo: id }).catch(
          (error: unknown) => debug?.("error", "Draft files could not be moved", error),
        )
        edit(id, (value, threads) => {
          const moved = threads.get("")
          const destination = threads.get(id)
          if (!moved) return value
          return {
            ...moved,
            text: moved.text || destination?.text || "",
            attachments: [
              ...new Map(
                [...(destination?.attachments ?? []), ...moved.attachments].map((file) => [
                  file.id,
                  file,
                ]),
              ).values(),
            ],
            settledAttachments: EMPTY_ATTACHMENTS,
            savedAttachments: [...(destination?.savedAttachments ?? []), ...moved.savedAttachments],
          }
        })
        edit("", () => undefined)
      },
      onAccepted: () => {
        storedThreadDraft(apiUrl, identity, key, "", "sent")
        void storedThreadAttachments({
          apiUrl,
          identity,
          threadId: key,
          update: (files) => files.filter((file) => !fileIds.has(file.id)),
        }).catch((error: unknown) =>
          debug?.("error", "Accepted draft files could not be cleared", error),
        )
      },
    }
  }

  const restore = useCallback(
    () => edit(threadId, (value) => ({ ...value, attachmentsLoaded: false })),
    [edit, threadId],
  )

  return {
    identity,
    text: draft.text,
    attachments: draft.attachments,
    attachmentsLoaded: draft.attachmentsLoaded,
    /** Attachment changes are still being written to storage. */
    saving: draft.attachments !== draft.settledAttachments,
    storageError: draft.storageError,
    setText: (text: string) => {
      storedThreadDraft(apiUrl, identity, threadId, text)
      edit(threadId, (value) => ({ ...value, text }))
    },
    updateAttachments: (update: (attachments: DraftAttachment[]) => DraftAttachment[]) =>
      edit(threadId, (value) => ({ ...value, attachments: update(value.attachments) })),
    /** Applies an upload's outcome in whichever conversation's draft holds the file now. */
    settleAttachment: (id: string, update: Partial<DraftAttachment>) =>
      setDrafts((current) => {
        if (current.apiUrl !== apiUrl || current.identity !== identity) return current
        for (const [key, value] of current.threads) {
          if (!value.attachments.some((file) => file.id === id)) continue
          const attachments = value.attachments.map((file) =>
            file.id === id ? { ...file, ...update } : file,
          )
          return {
            ...current,
            threads: new Map(current.threads).set(key, { ...value, attachments }),
          }
        }
        return current
      }),
    /** Hands the text and ready files to a send, keeping their stored copies until acceptance. */
    submit: (fileIds: ReadonlySet<string>) => {
      storedThreadDraft(apiUrl, identity, threadId, draft.text, "sent")
      storedThreadDraft(apiUrl, identity, threadId, "")
      const unsent = (files: DraftAttachment[]) => files.filter((file) => !fileIds.has(file.id))
      edit(threadId, (value) => {
        const attachments = unsent(value.attachments)
        return {
          ...value,
          text: "",
          attachments,
          settledAttachments:
            value.settledAttachments === value.attachments
              ? attachments
              : unsent(value.settledAttachments),
          savedAttachments: unsent(value.savedAttachments),
        }
      })
      return follow(fileIds, threadId)
    },
    /** Returns a refused send's stored text and files to the composer. */
    restore,
    /** Empties the new-conversation draft, as starting a new chat does. */
    reset: () => clear("", { ...EMPTY_DRAFT, attachmentsLoaded: true }),
    /** Drops a deleted conversation's draft. */
    forget: (id: string) => clear(id),
  }
}
